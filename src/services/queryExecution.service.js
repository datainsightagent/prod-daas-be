import { logger } from "../lib/logger.js";
import { resolveDomainPrismaForTenantId } from "../lib/tenantPrismaRouting.js";
import { runMysqlSelectQuery } from "../lib/db-connectors/mysql.connector.js";
import { runPostgresSelectQuery } from "../lib/db-connectors/postgres.connector.js";
import {
  DataSourceServiceError,
  resolveTenantDataSourceConnectionConfig,
} from "./dataSource.service.js";
import { validateReadOnlySql } from "./queryValidation.service.js";

export class QueryServiceError extends Error {
  constructor(message, statusCode, errorCode) {
    super(message);
    this.name = "QueryServiceError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

function mapExecutionError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();

  if (code === "QUERY_TIMEOUT") {
    return {
      status: "timeout",
      errorCode: "query_timeout",
      errorMessage: "Query timed out",
    };
  }

  if (
    code === "ER_PARSE_ERROR" ||
    code === "ER_SYNTAX_ERROR" ||
    code === "42601" ||
    message.includes("syntax error")
  ) {
    return {
      status: "failed",
      errorCode: "syntax_error",
      errorMessage: error instanceof Error ? error.message : "SQL syntax error",
    };
  }

  if (
    code === "ER_TABLEACCESS_DENIED_ERROR" ||
    code === "ER_DBACCESS_DENIED_ERROR" ||
    code === "ER_SPECIFIC_ACCESS_DENIED_ERROR" ||
    code === "42501" ||
    message.includes("permission denied") ||
    message.includes("access denied")
  ) {
    return {
      status: "failed",
      errorCode: "permission_denied",
      errorMessage: "Insufficient read permissions for query",
    };
  }

  if (
    code.includes("ECONNREFUSED") ||
    code.includes("ENOTFOUND") ||
    code.includes("ETIMEDOUT") ||
    message.includes("connect")
  ) {
    return {
      status: "failed",
      errorCode: "connection_failed",
      errorMessage: "Failed to connect to data source",
    };
  }

  return {
    status: "failed",
    errorCode: "unknown",
    errorMessage: error instanceof Error ? error.message : "Query execution failed",
  };
}

async function persistFailedRun({
  domainPrisma,
  runId,
  errorCode,
  errorMessage,
  status = "failed",
}) {
  await domainPrisma.queryRun.update({
    where: { runId },
    data: {
      status,
      errorCode,
      errorMessage,
      finishedAt: new Date(),
    },
  });
}

function toRunResponse(run, result) {
  return {
    run_id: run.runId,
    status: run.status,
    schema: Array.isArray(result?.schema) ? result.schema : [],
    rows: Array.isArray(result?.rows) ? result.rows : [],
    row_count: run.rowCount,
    truncated: run.truncated,
    ...(run.errorCode ? { error_code: run.errorCode } : {}),
    ...(run.errorMessage ? { error_message: run.errorMessage } : {}),
  };
}

async function executeSelectQuery(connection, { sql, rowLimit, timeoutMs, engineType }) {
  if (engineType === "mysql") {
    return runMysqlSelectQuery(connection, { sql, rowLimit, timeoutMs });
  }
  if (engineType === "postgres") {
    return runPostgresSelectQuery(connection, { sql, rowLimit, timeoutMs });
  }
  throw new QueryServiceError(
    `Engine '${engineType}' is not supported for query execution`,
    400,
    "engine_not_supported",
  );
}

export async function validateQuery({ sql }) {
  return validateReadOnlySql(sql);
}

/**
 * Run a read-only probe query on the tenant data source.
 * Always runs validateReadOnlySql first — unsafe SQL never executes.
 */
export async function runQuery({
  tenantId,
  dataSourceId,
  sql,
  timeoutSeconds = 30,
  rowLimit = 50,
  purpose = "probe",
}) {
  const domainPrisma = await resolveDomainPrismaForTenantId(tenantId);
  const validation = validateReadOnlySql(sql);

  if (!validation.valid) {
    await domainPrisma.queryRun.create({
      data: {
        tenantId,
        dataSourceId,
        sql,
        purpose,
        status: "failed",
        errorCode: "validation_error",
        errorMessage: validation.errors[0]?.message || "SQL validation failed",
        finishedAt: new Date(),
      },
    });

    throw new QueryServiceError(
      validation.errors[0]?.message || "SQL validation failed",
      400,
      "validation_error",
    );
  }

  let runId;

  try {
    const { connection } = await resolveTenantDataSourceConnectionConfig({
      tenantId,
      dataSourceId,
      prismaClient: domainPrisma,
      requireConnected: true,
    });

    const run = await domainPrisma.queryRun.create({
      data: {
        tenantId,
        dataSourceId,
        sql,
        purpose,
        status: "running",
      },
    });
    runId = run.runId;

    const result = await executeSelectQuery(connection, {
      sql,
      rowLimit,
      timeoutMs: timeoutSeconds * 1000,
      engineType: connection.type,
    });

    const updatedRun = await domainPrisma.queryRun.update({
      where: { runId },
      data: {
        status: "completed",
        rowCount: result.row_count,
        truncated: result.truncated,
        finishedAt: new Date(),
      },
    });

    await domainPrisma.queryResult.create({
      data: {
        runId,
        tenantId,
        schema: result.schema,
        rows: result.rows,
      },
    });

    logger.info({
      event: "query.run.completed",
      tenantId,
      dataSourceId,
      runId,
      purpose,
      rowCount: result.row_count,
      truncated: result.truncated,
    });

    return toRunResponse(updatedRun, result);
  } catch (error) {
    if (error instanceof QueryServiceError) {
      throw error;
    }

    if (error instanceof DataSourceServiceError) {
      throw new QueryServiceError(error.message, error.statusCode, error.errorCode);
    }

    const mapped = mapExecutionError(error);

    if (runId) {
      await persistFailedRun({
        domainPrisma,
        runId,
        errorCode: mapped.errorCode,
        errorMessage: mapped.errorMessage,
        status: mapped.status,
      }).catch(() => {});
    }

    logger.warn({
      event: "query.run.failed",
      tenantId,
      dataSourceId,
      runId: runId ?? null,
      purpose,
      errorCode: mapped.errorCode,
      message: mapped.errorMessage,
    });

    throw new QueryServiceError(
      mapped.errorMessage,
      mapped.status === "timeout" ? 504 : 502,
      mapped.errorCode,
    );
  }
}
