import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import {
  isTenantDbReadWriteEnabled,
  resolveDomainPrismaForAuth,
  resolveDomainPrismaForTenantId,
} from "../lib/tenantPrismaRouting.js";
import { listReadyTenantIds, getTenantPrismaClientByTenantId } from "../lib/tenantPrismaClient.js";
import { assertRequiredRole } from "./auth.service.js";
import {
  decryptDataSourcePassword,
  encryptDataSourcePassword,
} from "../lib/crypto/dataSourceCrypto.js";
import {
  mysqlInfoQuery,
  scanMysqlSchema,
  verifyMysqlReadOnly,
} from "../lib/db-connectors/mysql.connector.js";
import {
  postgresInfoQuery,
  verifyPostgresReadOnly,
} from "../lib/db-connectors/postgres.connector.js";
import {
  normalizeSampleRowLimit,
  SchemaSnapshotContractError,
  validateSchemaSnapshotPayload,
} from "../contracts/schemaSnapshot.contract.js";
import { computeSchemaDiff } from "./schemaChangeDiff.service.js";

const SUPPORTED_RUNTIME_ENGINES = new Set(["mysql", "postgres"]);
const SUPPORTED_CONNECTION_MODES = new Set(["secret_ref", "inline_dev"]);
const SCHEMA_SNAPSHOT_TERMINAL_STATES = new Set(["ready", "error"]);
const SCHEMA_SCAN_MAX_ATTEMPTS = 2;
const SCHEMA_SNAPSHOT_RETENTION_LIMIT = 10;
const SCHEMA_SNAPSHOT_ENQUEUE_MAX_RETRIES = 3;

/** Rotates through `listReadyTenantIds()` order so we do not always probe the same tenant first. */
let schemaScanClaimRoundRobinOffset = 0;

function getSchemaScanClaimTenantsPerPoll() {
  const raw = String(process.env.SCHEMA_SCAN_CLAIM_TENANTS_PER_POLL ?? "0").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.floor(n);
}

/**
 * @returns {{ batch: string[], tenantCount: number, startIndex: number }}
 */
function nextSchemaScanClaimTenantBatch(tenantIds) {
  const tenantCount = tenantIds.length;
  if (tenantCount === 0) {
    return { batch: [], tenantCount: 0, startIndex: 0 };
  }
  const maxPerPoll = getSchemaScanClaimTenantsPerPoll();
  const startIndex = schemaScanClaimRoundRobinOffset % tenantCount;
  const rotated = tenantIds.slice(startIndex).concat(tenantIds.slice(0, startIndex));
  const batch =
    maxPerPoll > 0
      ? rotated.slice(0, Math.min(maxPerPoll, tenantCount))
      : rotated;
  return { batch, tenantCount, startIndex };
}

function advanceSchemaScanClaimRoundRobin({ tenantCount, startIndex, batchLength, capped }) {
  if (tenantCount === 0 || batchLength === 0) {
    return;
  }
  if (capped) {
    schemaScanClaimRoundRobinOffset = (startIndex + batchLength) % tenantCount;
  } else {
    schemaScanClaimRoundRobinOffset = (startIndex + 1) % tenantCount;
  }
}

export class DataSourceServiceError extends Error {
  constructor(message, statusCode, errorCode) {
    super(message);
    this.name = "DataSourceServiceError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

function isUniqueConstraintViolation(error) {
  return String(error?.code || "") === "P2002";
}

function mapSchemaSnapshotSummary(row) {
  return {
    snapshot_id: row.snapshotId,
    data_source_id: row.dataSourceId,
    version: row.version,
    status: row.status,
    attempt_count: row.attemptCount,
    last_attempt_at: row.lastAttemptAt,
    next_retry_at: row.nextRetryAt,
    captured_at: row.capturedAt,
    error_code: row.errorCode,
    error_message: row.errorMessage,
    created_at: row.createdAt,
  };
}

function formatSchemaSnapshotPayloadForResponse(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.tables)) {
    return payload;
  }

  return {
    tables: payload.tables.map((table) => ({
      table_name: table.table_name ?? null,
      row_estimate: table.row_estimate ?? null,
      columns: Array.isArray(table.columns)
        ? table.columns.map((column) => ({
            name: column.name ?? null,
            type: column.type ?? null,
            nullable: Boolean(column.nullable),
            is_primary_key: Boolean(column.is_primary_key),
          }))
        : [],
      primary_key: Array.isArray(table.primary_key) ? table.primary_key : [],
      foreign_keys: Array.isArray(table.foreign_keys)
        ? table.foreign_keys.map((fk) => ({
            column: fk.column ?? null,
            ref_table: fk.ref_table ?? null,
            ref_column: fk.ref_column ?? null,
            ...(fk.ref_table_missing !== undefined
              ? { ref_table_missing: Boolean(fk.ref_table_missing) }
              : {}),
          }))
        : [],
      sample_rows: Array.isArray(table.sample_rows) ? table.sample_rows : [],
    })),
  };
}

function mapSchemaSnapshotDetail(row) {
  return {
    snapshot_id: row.snapshotId,
    tenant_id: row.tenantId,
    data_source_id: row.dataSourceId,
    version: row.version,
    status: row.status,
    attempt_count: row.attemptCount,
    last_attempt_at: row.lastAttemptAt,
    next_retry_at: row.nextRetryAt,
    captured_at: row.capturedAt,
    error_code: row.errorCode,
    error_message: row.errorMessage,
    payload: formatSchemaSnapshotPayloadForResponse(row.payload),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function mapSchemaChangeEventSummary(row) {
  return {
    change_event_id: row.changeEventId,
    data_source_id: row.dataSourceId,
    snapshot_id: row.snapshotId,
    previous_snapshot_id: row.previousSnapshotId,
    change_type: row.changeType,
    severity: row.severity,
    table_name: row.tableName,
    column_name: row.columnName,
    old_value: row.oldValue,
    new_value: row.newValue,
    acknowledged: row.acknowledged,
    acknowledged_at: row.acknowledgedAt,
    acknowledged_by: row.acknowledgedBy,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function maskSchemaSnapshotErrorMessage(message) {
  if (!message || typeof message !== "string") {
    return null;
  }
  return message.length > 1024 ? message.slice(0, 1024) : message;
}

async function pruneSchemaSnapshotHistory({
  tenantId,
  dataSourceId,
  keepLatest = SCHEMA_SNAPSHOT_RETENTION_LIMIT,
  prismaClient = prisma,
}) {
  const staleRows = await prismaClient.schemaSnapshot.findMany({
    where: {
      tenantId,
      dataSourceId,
      status: "ready",
    },
    orderBy: [{ version: "desc" }],
    skip: keepLatest,
    select: { snapshotId: true, version: true },
  });

  if (staleRows.length === 0) {
    return 0;
  }

  await prismaClient.schemaSnapshot.deleteMany({
    where: {
      snapshotId: {
        in: staleRows.map((row) => row.snapshotId),
      },
    },
  });

  await prismaClient.auditLog.create({
    data: {
      event: "schema_snapshot_pruned",
      tenantId,
      metadata: {
        data_source_id: dataSourceId,
        pruned_count: staleRows.length,
        pruned_versions: staleRows.map((row) => row.version),
        retention_limit: keepLatest,
      },
    },
  });

  return staleRows.length;
}

async function persistSchemaChangeEventsForSnapshot({
  tenantId,
  dataSourceId,
  snapshotId,
  previousSnapshotId,
  previousPayload,
  currentPayload,
  prismaClient = prisma,
}) {
  const diffEvents = computeSchemaDiff(previousPayload, currentPayload);
  if (diffEvents.length === 0) {
    return 0;
  }

  await prismaClient.schemaChangeEvent.createMany({
    data: diffEvents.map((event) => ({
      tenantId,
      dataSourceId,
      snapshotId,
      previousSnapshotId,
      changeType: event.changeType,
      severity: event.severity,
      tableName: event.tableName,
      columnName: event.columnName,
      oldValue: event.oldValue,
      newValue: event.newValue,
    })),
  });

  return diffEvents.length;
}

export function isRetryableSchemaScanError(error) {
  const errorCode = String(error?.errorCode || "");
  return (
    errorCode === "connection_refused" ||
    errorCode === "network_unreachable" ||
    errorCode === "connection_failed" ||
    errorCode === "schema_scan_failed"
  );
}

function maskErrorMessage(message) {
  if (!message || typeof message !== "string") {
    return null;
  }
  return message.length > 191 ? message.slice(0, 191) : message;
}

function mapConnectorError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();

  if (code.includes("ECONNREFUSED")) {
    return {
      errorCode: "connection_refused",
      message: "Database host is reachable but connection was refused",
    };
  }

  if (code.includes("ENOTFOUND") || code.includes("ETIMEDOUT")) {
    return {
      errorCode: "network_unreachable",
      message: "Unable to reach database host",
    };
  }

  if (code.includes("ER_ACCESS_DENIED_ERROR")) {
    return {
      errorCode: "invalid_credentials",
      message: "Database credentials are invalid",
    };
  }

  if (code.includes("28P01")) {
    return {
      errorCode: "invalid_credentials",
      message: "Database credentials are invalid",
    };
  }

  if (message.includes("access denied")) {
    return {
      errorCode: "insufficient_read_permissions",
      message: "Credential does not have required read permissions",
    };
  }

  return {
    errorCode: "connection_failed",
    message: "Database connection test failed",
  };
}

function isExpectedReadOnlyProbeFailure(engineType, error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();

  if (engineType === "mysql") {
    return (
      code === "ER_TABLEACCESS_DENIED_ERROR" ||
      code === "ER_DBACCESS_DENIED_ERROR" ||
      code === "ER_SPECIFIC_ACCESS_DENIED_ERROR" ||
      code === "ER_ACCESS_DENIED_ERROR" ||
      message.includes("command denied") ||
      message.includes("access denied")
    );
  }

  if (engineType === "postgres") {
    return (
      code === "42501" || // insufficient_privilege
      code === "25006" || // read_only_sql_transaction
      message.includes("permission denied") ||
      message.includes("read-only")
    );
  }

  return false;
}

async function executeWithRetry(fn, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

export async function getTenantScopedDataSourceOrFail(
  dataSourceId,
  tenantId,
  prismaClient = prisma,
) {
  const dataSource = await prismaClient.dataSource.findFirst({
    where: {
      id: dataSourceId,
      tenantId,
      deletedAt: null,
    },
  });

  if (!dataSource) {
    throw new DataSourceServiceError(
      "Data source not found",
      404,
      "not_found",
    );
  }

  return dataSource;
}

/** Latest ready snapshot payload for AI query context (Path 2+). */
export async function getLatestReadySchemaSnapshotPayload(
  prismaClient,
  tenantId,
  dataSourceId,
) {
  const row = await prismaClient.schemaSnapshot.findFirst({
    where: {
      tenantId,
      dataSourceId,
      status: "ready",
    },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    select: { payload: true },
  });

  return row?.payload ?? null;
}

async function addConnectionStatus({
  dataSourceId,
  status,
  errorCode = null,
  errorMessage = null,
  prismaClient = prisma,
}) {
  await prismaClient.connectionStatus.create({
    data: {
      dataSourceId,
      status,
      errorCode,
      errorMessage: maskErrorMessage(errorMessage),
      lastCheckedAt: new Date(),
    },
  });

  // PRD-02: keep status history capped to latest 30 checks.
  const staleRows = await prismaClient.connectionStatus.findMany({
    where: { dataSourceId },
    orderBy: { createdAt: "desc" },
    skip: 30,
    select: { id: true },
  });

  if (staleRows.length > 0) {
    await prismaClient.connectionStatus.deleteMany({
      where: {
        id: {
          in: staleRows.map((row) => row.id),
        },
      },
    });
  }
}

function assertEngineSupportedForRuntime(engineCode) {
  if (!SUPPORTED_RUNTIME_ENGINES.has(engineCode)) {
    throw new DataSourceServiceError(
      `Engine '${engineCode}' is registered but not enabled for runtime yet`,
      400,
      "engine_not_supported",
    );
  }
}

function resolveConnectionMode(inputMode) {
  const normalized = String(inputMode || "secret_ref").trim().toLowerCase();
  if (!SUPPORTED_CONNECTION_MODES.has(normalized)) {
    throw new DataSourceServiceError(
      "connection_mode must be one of: secret_ref, inline_dev",
      400,
      "validation_error",
    );
  }
  return normalized;
}

function tryDecryptPasswordOrThrow(payload) {
  try {
    return decryptDataSourcePassword(payload);
  } catch (_error) {
    throw new DataSourceServiceError(
      "Datasource credential decryption failed",
      500,
      "credential_decryption_failed",
    );
  }
}

async function resolveDataSourcePassword(dataSource) {
  if (dataSource.encryptedSecretPayload) {
    return tryDecryptPasswordOrThrow(dataSource.encryptedSecretPayload);
  }

  throw new DataSourceServiceError(
    "Secret payload not found for data source",
    500,
    "secret_unavailable",
  );
}

/**
 * Runtime connection config for executing SQL against a tenant data source.
 * Caller must already have loaded and tenant-scoped the data source row.
 */
export async function buildDataSourceConnectionConfig(dataSource) {
  assertEngineSupportedForRuntime(dataSource.type);

  const password = await resolveDataSourcePassword(dataSource);

  return {
    type: dataSource.type,
    host: dataSource.host,
    port: dataSource.port,
    username: dataSource.username,
    password,
    databaseName: dataSource.databaseName,
  };
}

/**
 * Load a tenant data source and return a ready-to-use connection config.
 */
export async function resolveTenantDataSourceConnectionConfig({
  tenantId,
  dataSourceId,
  prismaClient = prisma,
  requireConnected = true,
}) {
  const dataSource = await getTenantScopedDataSourceOrFail(
    dataSourceId,
    tenantId,
    prismaClient,
  );

  if (requireConnected && dataSource.status !== "connected") {
    throw new DataSourceServiceError(
      "Data source is not connected",
      400,
      "data_source_not_connected",
    );
  }

  return {
    dataSource,
    connection: await buildDataSourceConnectionConfig(dataSource),
  };
}

export async function createDataSource({ auth, input }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);

  const required = [
    "name",
    "type",
    "host",
    "port",
    "database_name",
    "username",
    "password",
  ];

  for (const key of required) {
    if (!input?.[key]) {
      throw new DataSourceServiceError(
        `${key} is required`,
        400,
        "validation_error",
      );
    }
  }

  const engine = await domainPrisma.dbEngine.findUnique({
    where: { code: String(input.type).toLowerCase() },
  });

  if (!engine) {
    throw new DataSourceServiceError("Unknown DB engine", 400, "validation_error");
  }

  assertEngineSupportedForRuntime(engine.code);
  const connectionMode = resolveConnectionMode(input.connection_mode);

  let encryptedPayload;
  try {
    encryptedPayload = encryptDataSourcePassword(String(input.password));
  } catch (_error) {
    throw new DataSourceServiceError(
      "Datasource credential encryption is not configured",
      503,
      "credential_encryption_unavailable",
    );
  }

  const created = await domainPrisma.dataSource.create({
    data: {
      tenantId: auth.tenantId,
      name: String(input.name).trim(),
      type: engine.code,
      host: String(input.host).trim(),
      port: Number(input.port),
      databaseName: String(input.database_name).trim(),
      username: String(input.username).trim(),
      connectionMode,
      encryptedSecretPayload: encryptedPayload,
      status: "pending",
    },
  });

  await addConnectionStatus({
    dataSourceId: created.id,
    status: "pending",
    prismaClient: domainPrisma,
  });

  logger.info({
    event: "datasource.created",
    tenantId: auth.tenantId,
    userId: auth.userId,
    dataSourceId: created.id,
    engine: created.type,
  });

  return {
    data_source_id: created.id,
    status: "pending",
  };
}

async function runMysqlConnectionTest(dataSource, prismaClient = prisma) {
  const password = await resolveDataSourcePassword(dataSource);

  const mysqlConfig = {
    host: dataSource.host,
    port: dataSource.port,
    username: dataSource.username,
    password,
    databaseName: dataSource.databaseName,
  };

  await executeWithRetry(() => mysqlInfoQuery(mysqlConfig), 2);

  try {
    await executeWithRetry(() => verifyMysqlReadOnly(mysqlConfig), 0);
    await prismaClient.dataSource.update({
      where: { id: dataSource.id },
      data: { status: "error" },
    });
    await addConnectionStatus({
      dataSourceId: dataSource.id,
      status: "error",
      errorCode: "writable_credential",
      errorMessage: "Credential has write capability",
      prismaClient,
    });
    throw new DataSourceServiceError(
      "Writable credential is not allowed",
      400,
      "writable_credential",
    );
  } catch (error) {
    if (error instanceof DataSourceServiceError) {
      throw error;
    }
    if (isExpectedReadOnlyProbeFailure("mysql", error)) {
      // Permission-denied probe means write access is blocked => readonly is enforced.
    } else {
      throw error;
    }
  }

  await prismaClient.dataSource.update({
    where: { id: dataSource.id },
    data: { status: "connected" },
  });
  await addConnectionStatus({
    dataSourceId: dataSource.id,
    status: "connected",
    prismaClient,
  });
}

async function runPostgresConnectionTest(dataSource, prismaClient = prisma) {
  const password = await resolveDataSourcePassword(dataSource);

  const pgConfig = {
    host: dataSource.host,
    port: dataSource.port,
    username: dataSource.username,
    password,
    databaseName: dataSource.databaseName,
  };

  await executeWithRetry(() => postgresInfoQuery(pgConfig), 2);

  try {
    await executeWithRetry(() => verifyPostgresReadOnly(pgConfig), 0);
    await prismaClient.dataSource.update({
      where: { id: dataSource.id },
      data: { status: "error" },
    });
    await addConnectionStatus({
      dataSourceId: dataSource.id,
      status: "error",
      errorCode: "writable_credential",
      errorMessage: "Credential has write capability",
      prismaClient,
    });
    throw new DataSourceServiceError(
      "Writable credential is not allowed",
      400,
      "writable_credential",
    );
  } catch (error) {
    if (error instanceof DataSourceServiceError) {
      throw error;
    }
    if (isExpectedReadOnlyProbeFailure("postgres", error)) {
      // Permission-denied probe means write access is blocked => readonly is enforced.
    } else {
      throw error;
    }
  }

  await prismaClient.dataSource.update({
    where: { id: dataSource.id },
    data: { status: "connected" },
  });
  await addConnectionStatus({
    dataSourceId: dataSource.id,
    status: "connected",
    prismaClient,
  });
}

export async function testDataSourceConnection({ auth, dataSourceId }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);

  const dataSource = await getTenantScopedDataSourceOrFail(
    dataSourceId,
    auth.tenantId,
    domainPrisma,
  );
  assertEngineSupportedForRuntime(dataSource.type);

  await domainPrisma.dataSource.update({
    where: { id: dataSource.id },
    data: { status: "connecting" },
  });
  await addConnectionStatus({
    dataSourceId: dataSource.id,
    status: "connecting",
    prismaClient: domainPrisma,
  });

  try {
    if (dataSource.type === "mysql") {
      await runMysqlConnectionTest(dataSource, domainPrisma);
    } else if (dataSource.type === "postgres") {
      await runPostgresConnectionTest(dataSource, domainPrisma);
    }
  } catch (error) {
    if (error instanceof DataSourceServiceError) {
      logger.warn({
        event: "datasource.test.failure",
        tenantId: auth.tenantId,
        userId: auth.userId,
        dataSourceId: dataSource.id,
        errorCode: error.errorCode,
      });
      throw error;
    }

    const mapped = mapConnectorError(error);
    await domainPrisma.dataSource.update({
      where: { id: dataSource.id },
      data: { status: "error" },
    });
    await addConnectionStatus({
      dataSourceId: dataSource.id,
      status: "error",
      errorCode: mapped.errorCode,
      errorMessage: mapped.message,
      prismaClient: domainPrisma,
    });

    logger.warn({
      event: "datasource.test.failure",
      tenantId: auth.tenantId,
      userId: auth.userId,
      dataSourceId: dataSource.id,
      errorCode: mapped.errorCode,
    });

    throw new DataSourceServiceError(mapped.message, 400, mapped.errorCode);
  }

  logger.info({
    event: "datasource.test.success",
    tenantId: auth.tenantId,
    userId: auth.userId,
    dataSourceId: dataSource.id,
  });

  return {
    data_source_id: dataSource.id,
    status: "connected",
  };
}

export async function listDataSources({ auth }) {
  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const rows = await domainPrisma.dataSource.findMany({
    where: {
      tenantId: auth.tenantId,
      deletedAt: null,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      name: true,
      type: true,
      host: true,
      port: true,
      databaseName: true,
      onboarded: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return rows.map((row) => ({
    data_source_id: row.id,
    name: row.name,
    type: row.type,
    host: row.host,
    port: row.port,
    database_name: row.databaseName,
    onboarded: Boolean(row.onboarded),
    status: row.status,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }));
}

export async function getDataSourceDetail({ auth, dataSourceId }) {
  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const row = await getTenantScopedDataSourceOrFail(
    dataSourceId,
    auth.tenantId,
    domainPrisma,
  );

  const latestStatus = await domainPrisma.connectionStatus.findFirst({
    where: { dataSourceId: row.id },
    orderBy: { createdAt: "desc" },
  });

  return {
    data_source_id: row.id,
    tenant_id: row.tenantId,
    name: row.name,
    type: row.type,
    host: row.host,
    port: row.port,
    database_name: row.databaseName,
    username: row.username,
    connection_mode: row.connectionMode,
    password_set: Boolean(row.encryptedSecretPayload),
    onboarded: Boolean(row.onboarded),
    status: row.status,
    connection_status: latestStatus
      ? {
          status: latestStatus.status,
          last_checked_at: latestStatus.lastCheckedAt,
          error_code: latestStatus.errorCode,
          error_message: latestStatus.errorMessage,
        }
      : null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function deleteDataSource({ auth, dataSourceId }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const row = await getTenantScopedDataSourceOrFail(
    dataSourceId,
    auth.tenantId,
    domainPrisma,
  );

  await domainPrisma.dataSource.update({
    where: { id: row.id },
    data: {
      status: "deleted",
      deletedAt: new Date(),
    },
  });

  await addConnectionStatus({
    dataSourceId: row.id,
    status: "deleted",
    prismaClient: domainPrisma,
  });

  return { deleted: true, data_source_id: row.id };
}

export async function enqueueSchemaScan({ auth, dataSourceId, input }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const dataSource = await getTenantScopedDataSourceOrFail(
    dataSourceId,
    auth.tenantId,
    domainPrisma,
  );
  assertEngineSupportedForRuntime(dataSource.type);

  const includeForeignKeys = input?.include_foreign_keys ?? true;
  if (typeof includeForeignKeys !== "boolean") {
    throw new DataSourceServiceError(
      "include_foreign_keys must be a boolean",
      400,
      "validation_error",
    );
  }

  let sampleRowsPerTable;
  try {
    sampleRowsPerTable = normalizeSampleRowLimit(input?.sample_rows_per_table);
  } catch (error) {
    if (error instanceof SchemaSnapshotContractError) {
      throw new DataSourceServiceError(error.message, 400, "validation_error");
    }
    throw error;
  }

  let snapshot = null;
  for (
    let attempt = 0;
    attempt < SCHEMA_SNAPSHOT_ENQUEUE_MAX_RETRIES && !snapshot;
    attempt += 1
  ) {
    try {
      const latest = await domainPrisma.schemaSnapshot.aggregate({
        where: {
          tenantId: auth.tenantId,
          dataSourceId: dataSource.id,
        },
        _max: {
          version: true,
        },
      });

      const nextVersion = (latest._max.version ?? 0) + 1;

      snapshot = await domainPrisma.schemaSnapshot.create({
        data: {
          tenantId: auth.tenantId,
          dataSourceId: dataSource.id,
          version: nextVersion,
          status: "queued",
          payload: {
            include_foreign_keys: includeForeignKeys,
            sample_rows_per_table: sampleRowsPerTable,
          },
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        if (attempt < SCHEMA_SNAPSHOT_ENQUEUE_MAX_RETRIES - 1) {
          continue;
        }
        throw new DataSourceServiceError(
          "Unable to enqueue schema scan due to concurrent version allocation",
          409,
          "schema_scan_enqueue_conflict",
        );
      }
      throw error;
    }
  }

  if (!snapshot) {
    throw new DataSourceServiceError(
      "Unable to enqueue schema scan due to concurrent version allocation",
      409,
      "schema_scan_enqueue_conflict",
    );
  }

  logger.info({
    event: "schema.scan.queued",
    tenantId: auth.tenantId,
    userId: auth.userId,
    dataSourceId: dataSource.id,
    snapshotId: snapshot.snapshotId,
    version: snapshot.version,
  });

  return {
    snapshot_id: snapshot.snapshotId,
    status: snapshot.status,
    version: snapshot.version,
  };
}

export async function listSchemaSnapshots({ auth, dataSourceId }) {
  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const dataSource = await getTenantScopedDataSourceOrFail(
    dataSourceId,
    auth.tenantId,
    domainPrisma,
  );
  const rows = await domainPrisma.schemaSnapshot.findMany({
    where: {
      tenantId: auth.tenantId,
      dataSourceId: dataSource.id,
    },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
  });

  return rows.map(mapSchemaSnapshotSummary);
}

export async function getSchemaSnapshotById({ auth, snapshotId }) {
  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const row = await domainPrisma.schemaSnapshot.findFirst({
    where: {
      snapshotId,
      tenantId: auth.tenantId,
    },
  });

  if (!row) {
    throw new DataSourceServiceError(
      "Schema snapshot not found",
      404,
      "not_found",
    );
  }

  return mapSchemaSnapshotDetail(row);
}

export async function listSchemaChangeEvents({
  auth,
  dataSourceId,
  acknowledged,
  limit = 50,
}) {
  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const dataSource = await getTenantScopedDataSourceOrFail(
    dataSourceId,
    auth.tenantId,
    domainPrisma,
  );
  const normalizedLimit = Number.isFinite(Number(limit))
    ? Math.min(Math.max(Number(limit), 1), 200)
    : 50;

  const where = {
    tenantId: auth.tenantId,
    dataSourceId: dataSource.id,
  };
  if (acknowledged !== undefined) {
    where.acknowledged = Boolean(acknowledged);
  }

  const rows = await domainPrisma.schemaChangeEvent.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { changeEventId: "desc" }],
    take: normalizedLimit,
  });

  return rows.map(mapSchemaChangeEventSummary);
}

export async function acknowledgeSchemaChangeEvent({
  auth,
  changeEventId,
}) {
  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const event = await domainPrisma.schemaChangeEvent.findFirst({
    where: {
      changeEventId,
      tenantId: auth.tenantId,
    },
  });

  if (!event) {
    throw new DataSourceServiceError(
      "Schema change event not found",
      404,
      "not_found",
    );
  }

  const updated = await domainPrisma.schemaChangeEvent.update({
    where: { changeEventId: event.changeEventId },
    data: {
      acknowledged: true,
      acknowledgedAt: new Date(),
      acknowledgedBy: auth.userId,
    },
  });

  return mapSchemaChangeEventSummary(updated);
}

export async function markSchemaSnapshotCompleted({
  tenantId,
  snapshotId,
  payload,
  capturedAt = new Date(),
}) {
  const domainPrisma = await resolveDomainPrismaForTenantId(tenantId);
  const snapshot = await domainPrisma.schemaSnapshot.findFirst({
    where: { snapshotId, tenantId },
    select: { status: true },
  });

  if (!snapshot) {
    throw new DataSourceServiceError("Schema snapshot not found", 404, "not_found");
  }
  if (SCHEMA_SNAPSHOT_TERMINAL_STATES.has(snapshot.status)) {
    throw new DataSourceServiceError(
      "Schema snapshot is already finalized",
      409,
      "snapshot_already_finalized",
    );
  }

  return domainPrisma.schemaSnapshot.update({
    where: { snapshotId },
    data: {
      status: "ready",
      nextRetryAt: null,
      capturedAt,
      payload,
      errorCode: null,
      errorMessage: null,
    },
  });
}

export async function claimNextSchemaScanJob() {
  const now = new Date();
  const claimFromClient = async (prismaClient, tenantIdHint = null) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const claimed = await prismaClient.$transaction(async (tx) => {
        const next = await tx.schemaSnapshot.findFirst({
          where: {
            status: "queued",
            OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
            dataSource: {
              deletedAt: null,
            },
          },
          orderBy: [{ createdAt: "asc" }, { snapshotId: "asc" }],
          select: {
            snapshotId: true,
            tenantId: true,
            dataSourceId: true,
            version: true,
            attemptCount: true,
          },
        });

        if (!next) {
          return null;
        }

        const updated = await tx.schemaSnapshot.updateMany({
          where: {
            snapshotId: next.snapshotId,
            status: "queued",
          },
          data: {
            status: "running",
            attemptCount: {
              increment: 1,
            },
            lastAttemptAt: now,
            nextRetryAt: null,
            errorCode: null,
            errorMessage: null,
          },
        });

        if (updated.count !== 1) {
          return null;
        }

        return {
          snapshotId: next.snapshotId,
          tenantId: next.tenantId ?? tenantIdHint,
          dataSourceId: next.dataSourceId,
          version: next.version,
          attemptCount: next.attemptCount + 1,
        };
      });

      if (claimed) return claimed;
    }
    return null;
  };

  if (!isTenantDbReadWriteEnabled()) {
    return claimFromClient(prisma);
  }

  const tenantIds = await listReadyTenantIds();
  const maxPerPoll = getSchemaScanClaimTenantsPerPoll();
  const { batch, tenantCount, startIndex } = nextSchemaScanClaimTenantBatch(tenantIds);
  const capped = maxPerPoll > 0;

  try {
    for (const tenantId of batch) {
      try {
        const tenantPrisma = await getTenantPrismaClientByTenantId(tenantId);
        const claimed = await claimFromClient(tenantPrisma, tenantId);
        if (claimed) {
          return claimed;
        }
      } catch (err) {
        logger.warn({
          event: "schema.scan.claim.tenant_client_failed",
          tenantId,
          err: err?.message || String(err),
        });
      }
    }
  } finally {
    advanceSchemaScanClaimRoundRobin({
      tenantCount,
      startIndex,
      batchLength: batch.length,
      capped,
    });
  }

  return claimFromClient(prisma);
}

export async function scheduleSchemaSnapshotRetry({
  tenantId,
  snapshotId,
  errorCode,
  errorMessage,
  delayMs = 15000,
}) {
  const domainPrisma = await resolveDomainPrismaForTenantId(tenantId);
  const snapshot = await domainPrisma.schemaSnapshot.findFirst({
    where: { snapshotId, tenantId },
    select: { attemptCount: true },
  });

  if (!snapshot) {
    throw new DataSourceServiceError("Schema snapshot not found", 404, "not_found");
  }

  if (snapshot.attemptCount >= SCHEMA_SCAN_MAX_ATTEMPTS) {
    return false;
  }

  await domainPrisma.schemaSnapshot.update({
    where: { snapshotId },
    data: {
      status: "queued",
      nextRetryAt: new Date(Date.now() + delayMs),
      errorCode,
      errorMessage: maskSchemaSnapshotErrorMessage(errorMessage),
    },
  });

  return true;
}

export async function executeSchemaScanForSnapshot({
  tenantId,
  snapshotId,
  statusAlreadyRunning = false,
}) {
  const domainPrisma = await resolveDomainPrismaForTenantId(tenantId);
  const snapshot = await domainPrisma.schemaSnapshot.findFirst({
    where: {
      snapshotId,
      tenantId,
    },
    include: {
      dataSource: true,
    },
  });

  if (!snapshot) {
    throw new DataSourceServiceError("Schema snapshot not found", 404, "not_found");
  }

  if (SCHEMA_SNAPSHOT_TERMINAL_STATES.has(snapshot.status)) {
    throw new DataSourceServiceError(
      "Schema snapshot is already finalized",
      409,
      "snapshot_already_finalized",
    );
  }

  if (!statusAlreadyRunning) {
    await domainPrisma.schemaSnapshot.update({
      where: { snapshotId: snapshot.snapshotId },
      data: {
        status: "running",
        attemptCount: {
          increment: 1,
        },
        lastAttemptAt: new Date(),
        nextRetryAt: null,
        errorCode: null,
        errorMessage: null,
      },
    });
  }

  try {
    const startedAt = Date.now();

    logger.info({
      event: "schema.scan.started",
      tenantId: snapshot.tenantId,
      dataSourceId: snapshot.dataSourceId,
      snapshotId: snapshot.snapshotId,
      version: snapshot.version,
    });

    if (snapshot.dataSource.deletedAt) {
      throw new DataSourceServiceError(
        "Schema scan is blocked because data source is deleted",
        409,
        "data_source_deleted",
      );
    }
    const password = await resolveDataSourcePassword(snapshot.dataSource);
    const dbConfig = {
      host: snapshot.dataSource.host,
      port: snapshot.dataSource.port,
      username: snapshot.dataSource.username,
      password,
      databaseName: snapshot.dataSource.databaseName,
    };

    const includeForeignKeys = Boolean(snapshot.payload?.include_foreign_keys ?? true);
    const sampleRowsPerTable = normalizeSampleRowLimit(
      snapshot.payload?.sample_rows_per_table,
    );

    if (snapshot.dataSource.type !== "mysql") {
      throw new DataSourceServiceError(
        "Schema scan currently supports mysql only",
        400,
        "engine_not_supported",
      );
    }

    const payload = await executeWithRetry(
      () =>
        scanMysqlSchema(dbConfig, {
          includeForeignKeys,
          sampleRowsPerTable,
        }),
      1,
    );
    const validatedPayload = validateSchemaSnapshotPayload(payload);

    const readyRow = await markSchemaSnapshotCompleted({
      tenantId: snapshot.tenantId,
      snapshotId: snapshot.snapshotId,
      payload: validatedPayload,
      capturedAt: new Date(),
    });

    const previousReadySnapshot = await domainPrisma.schemaSnapshot.findFirst({
      where: {
        tenantId: snapshot.tenantId,
        dataSourceId: snapshot.dataSourceId,
        status: "ready",
        version: { lt: snapshot.version },
      },
      orderBy: [{ version: "desc" }],
      select: {
        snapshotId: true,
        payload: true,
      },
    });

    const schemaChangeEventCount = previousReadySnapshot
      ? await persistSchemaChangeEventsForSnapshot({
          tenantId: snapshot.tenantId,
          dataSourceId: snapshot.dataSourceId,
          snapshotId: snapshot.snapshotId,
          previousSnapshotId: previousReadySnapshot.snapshotId,
          previousPayload: previousReadySnapshot.payload,
          currentPayload: validatedPayload,
          prismaClient: domainPrisma,
        })
      : 0;

    const declaredFkCount = validatedPayload.tables.reduce(
      (acc, table) => acc + table.foreign_keys.length,
      0,
    );
    const inferredFkCount = validatedPayload.tables.reduce(
      (acc, table) =>
        acc +
        table.foreign_keys.filter((fk) => fk.ref_table_missing === true).length,
      0,
    );

    const prunedCount = await pruneSchemaSnapshotHistory({
      tenantId: snapshot.tenantId,
      dataSourceId: snapshot.dataSourceId,
      prismaClient: domainPrisma,
    });

    logger.info({
      event: "schema.scan.completed",
      tenantId: snapshot.tenantId,
      dataSourceId: snapshot.dataSourceId,
      snapshotId: snapshot.snapshotId,
      version: snapshot.version,
      tableCount: validatedPayload.tables.length,
      fkDeclaredCount: declaredFkCount,
      fkInferredCount: inferredFkCount,
      schemaChangeEventCount,
      prunedCount,
      durationMs: Date.now() - startedAt,
    });

    return mapSchemaSnapshotDetail(readyRow);
  } catch (error) {
    const errorCode =
      error instanceof DataSourceServiceError ? error.errorCode : "schema_scan_failed";

    await domainPrisma.schemaSnapshot.update({
      where: { snapshotId: snapshot.snapshotId },
      data: {
        status: "error",
        errorCode,
        errorMessage: maskSchemaSnapshotErrorMessage(error?.message),
      },
    });

    logger.warn({
      event: "schema.scan.failed",
      tenantId: snapshot.tenantId,
      dataSourceId: snapshot.dataSourceId,
      snapshotId: snapshot.snapshotId,
      errorCode,
      durationMs:
        snapshot.lastAttemptAt instanceof Date
          ? Date.now() - snapshot.lastAttemptAt.getTime()
          : undefined,
    });

    if (error instanceof DataSourceServiceError) {
      throw error;
    }
    throw new DataSourceServiceError(
      "Schema scan failed",
      500,
      "schema_scan_failed",
    );
  }
}
