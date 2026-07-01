import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  const prisma = {
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    dbEngine: {
      findUnique: vi.fn(),
    },
    dataSource: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    connectionStatus: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };

  return {
    prisma,
    assertRequiredRole: vi.fn(),
    encryptDataSourcePassword: vi.fn(),
    decryptDataSourcePassword: vi.fn(),
    mysqlInfoQuery: vi.fn(),
    verifyMysqlReadOnly: vi.fn(),
    scanMysqlSchema: vi.fn(),
    postgresInfoQuery: vi.fn(),
    verifyPostgresReadOnly: vi.fn(),
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn(),
    loggerError: vi.fn(),
  };
});

vi.mock("../src/lib/prisma.js", () => ({
  prisma: mocked.prisma,
}));

vi.mock("../src/services/auth.service.js", () => ({
  assertRequiredRole: mocked.assertRequiredRole,
}));

vi.mock("../src/lib/crypto/dataSourceCrypto.js", () => ({
  encryptDataSourcePassword: mocked.encryptDataSourcePassword,
  decryptDataSourcePassword: mocked.decryptDataSourcePassword,
}));

vi.mock("../src/lib/db-connectors/mysql.connector.js", () => ({
  mysqlInfoQuery: mocked.mysqlInfoQuery,
  verifyMysqlReadOnly: mocked.verifyMysqlReadOnly,
  scanMysqlSchema: mocked.scanMysqlSchema,
}));

vi.mock("../src/lib/db-connectors/postgres.connector.js", () => ({
  postgresInfoQuery: mocked.postgresInfoQuery,
  verifyPostgresReadOnly: mocked.verifyPostgresReadOnly,
}));

vi.mock("../src/lib/logger.js", () => ({
  logger: {
    info: mocked.loggerInfo,
    warn: mocked.loggerWarn,
    error: mocked.loggerError,
  },
}));

import {
  createDataSource,
  DataSourceServiceError,
  deleteDataSource,
  getDataSourceDetail,
  testDataSourceConnection,
} from "../src/services/dataSource.service.js";

describe("dataSource.service PRD-02 critical behaviors", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocked.assertRequiredRole.mockImplementation(() => {});
    mocked.prisma.$queryRaw.mockResolvedValue([]);
    mocked.prisma.$queryRawUnsafe.mockResolvedValue([{ count_value: 0 }]);
    mocked.prisma.connectionStatus.create.mockResolvedValue({});
    mocked.prisma.connectionStatus.findMany.mockResolvedValue([]);
    mocked.prisma.connectionStatus.deleteMany.mockResolvedValue({ count: 0 });
    mocked.prisma.dataSource.update.mockResolvedValue({});
    mocked.encryptDataSourcePassword.mockReturnValue({
      v: "v1",
      alg: "aes-256-gcm",
      keyId: "v1",
      iv: "iv",
      ct: "ct",
      tag: "tag",
      createdAt: "2026-04-27T00:00:00.000Z",
    });
    mocked.decryptDataSourcePassword.mockReturnValue("p");
  });

  it("rejects seeded-but-disabled engine with engine_not_supported", async () => {
    mocked.prisma.dbEngine.findUnique.mockResolvedValue({
      code: "mssql",
    });

    await expect(
      createDataSource({
        auth: { tenantId: "tenantA", userId: "userA", role: "tenant_admin" },
        input: {
          name: "PG source",
          type: "mssql",
          host: "127.0.0.1",
          port: 1433,
          database_name: "db",
          username: "u",
          password: "p",
        },
      }),
    ).rejects.toMatchObject({
      name: "DataSourceServiceError",
      errorCode: "engine_not_supported",
      statusCode: 400,
    });
  });

  it("creates datasource with pending status and accepted connection_mode", async () => {
    mocked.prisma.dbEngine.findUnique.mockResolvedValue({
      code: "mysql",
    });
    mocked.prisma.dataSource.create.mockResolvedValue({
      id: "ds-create-1",
      type: "mysql",
    });

    await expect(
      createDataSource({
        auth: { tenantId: "tenantA", userId: "userA", role: "tenant_admin" },
        input: {
          name: "MySQL source",
          type: "mysql",
          host: "127.0.0.1",
          port: 3306,
          database_name: "sample_db",
          username: "ro_user",
          password: "StrongPass!123",
          connection_mode: "inline_dev",
        },
      }),
    ).resolves.toMatchObject({
      data_source_id: "ds-create-1",
      status: "pending",
    });
  });

  it("rejects unsupported connection_mode value", async () => {
    mocked.prisma.dbEngine.findUnique.mockResolvedValue({
      code: "mysql",
    });

    await expect(
      createDataSource({
        auth: { tenantId: "tenantA", userId: "userA", role: "tenant_admin" },
        input: {
          name: "MySQL source",
          type: "mysql",
          host: "127.0.0.1",
          port: 3306,
          database_name: "sample_db",
          username: "ro_user",
          password: "StrongPass!123",
          connection_mode: "invalid_mode",
        },
      }),
    ).rejects.toMatchObject({
      name: "DataSourceServiceError",
      errorCode: "validation_error",
      statusCode: 400,
    });
  });

  it("runs postgres test-connection and marks connected", async () => {
    mocked.prisma.dataSource.findFirst.mockResolvedValue({
      id: "ds-pg",
      tenantId: "tenantA",
      type: "postgres",
      host: "127.0.0.1",
      port: 5432,
      username: "pg_ro_user",
      databaseName: "prd02_target_db",
      encryptedSecretPayload: { keyId: "v1", ct: "x", iv: "x", tag: "x", alg: "aes-256-gcm" },
      deletedAt: null,
    });
    mocked.postgresInfoQuery.mockResolvedValue("PostgreSQL 16");
    const readonlyErr = new Error("permission denied for temporary table");
    readonlyErr.code = "42501";
    mocked.verifyPostgresReadOnly.mockRejectedValue(readonlyErr);

    await expect(
      testDataSourceConnection({
        auth: { tenantId: "tenantA", userId: "userA", role: "tenant_admin" },
        dataSourceId: "ds-pg",
      }),
    ).resolves.toMatchObject({
      data_source_id: "ds-pg",
      status: "connected",
    });
  });

  it("returns not_found for cross-tenant detail access", async () => {
    mocked.prisma.dataSource.findFirst.mockResolvedValue(null);

    await expect(
      getDataSourceDetail({
        auth: { tenantId: "tenantB" },
        dataSourceId: "ds-from-tenantA",
      }),
    ).rejects.toMatchObject({
      name: "DataSourceServiceError",
      errorCode: "not_found",
      statusCode: 404,
    });
  });

  it("rejects writable credentials during test-connection", async () => {
    mocked.prisma.dataSource.findFirst.mockResolvedValue({
      id: "ds1",
      tenantId: "tenantA",
      type: "mysql",
      host: "127.0.0.1",
      port: 3306,
      username: "rw_user",
      databaseName: "prd02_target_db",
      encryptedSecretPayload: { keyId: "v1", ct: "x", iv: "x", tag: "x", alg: "aes-256-gcm" },
      deletedAt: null,
    });
    mocked.mysqlInfoQuery.mockResolvedValue("8.0.0");
    // Writable credential path: read-only probe unexpectedly succeeds.
    mocked.verifyMysqlReadOnly.mockResolvedValue(undefined);

    await expect(
      testDataSourceConnection({
        auth: { tenantId: "tenantA", userId: "userA", role: "tenant_admin" },
        dataSourceId: "ds1",
      }),
    ).rejects.toSatisfy((error) => {
      return (
        error instanceof DataSourceServiceError &&
        error.errorCode === "writable_credential" &&
        error.statusCode === 400
      );
    });
  });

  it("maps ECONNREFUSED to connection_refused", async () => {
    mocked.prisma.dataSource.findFirst.mockResolvedValue({
      id: "ds1",
      tenantId: "tenantA",
      type: "mysql",
      host: "127.0.0.1",
      port: 3306,
      username: "u",
      databaseName: "prd02_target_db",
      encryptedSecretPayload: { keyId: "v1", ct: "x", iv: "x", tag: "x", alg: "aes-256-gcm" },
      deletedAt: null,
    });
    const err = new Error("refused");
    err.code = "ECONNREFUSED";
    mocked.mysqlInfoQuery.mockRejectedValue(err);

    await expect(
      testDataSourceConnection({
        auth: { tenantId: "tenantA", userId: "userA", role: "tenant_admin" },
        dataSourceId: "ds1",
      }),
    ).rejects.toMatchObject({
      errorCode: "connection_refused",
      statusCode: 400,
    });
  });

  it("prunes connection status history beyond 30 rows", async () => {
    mocked.prisma.dataSource.findFirst.mockResolvedValue({
      id: "ds1",
      tenantId: "tenantA",
      type: "mysql",
      host: "127.0.0.1",
      port: 3306,
      username: "ro_user",
      databaseName: "prd02_target_db",
      encryptedSecretPayload: { keyId: "v1", ct: "x", iv: "x", tag: "x", alg: "aes-256-gcm" },
      deletedAt: null,
    });
    mocked.mysqlInfoQuery.mockResolvedValue("8.0.0");
    const readonlyErr = new Error("command denied");
    readonlyErr.code = "ER_TABLEACCESS_DENIED_ERROR";
    mocked.verifyMysqlReadOnly.mockRejectedValue(readonlyErr);
    mocked.prisma.connectionStatus.findMany.mockResolvedValue([
      { id: "old-1" },
      { id: "old-2" },
    ]);

    await testDataSourceConnection({
      auth: { tenantId: "tenantA", userId: "userA", role: "tenant_admin" },
      dataSourceId: "ds1",
    });

    expect(mocked.prisma.connectionStatus.deleteMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["old-1", "old-2"],
        },
      },
    });
  });

  it("soft-deletes data source even when dependent rows exist", async () => {
    mocked.prisma.dataSource.findFirst.mockResolvedValue({
      id: "ds-with-links",
      tenantId: "tenantA",
      deletedAt: null,
    });

    const result = await deleteDataSource({
      auth: { tenantId: "tenantA", userId: "userA", role: "tenant_admin" },
      dataSourceId: "ds-with-links",
    });

    expect(result).toEqual({ deleted: true, data_source_id: "ds-with-links" });
    expect(mocked.prisma.dataSource.update).toHaveBeenCalledWith({
      where: { id: "ds-with-links" },
      data: expect.objectContaining({
        status: "deleted",
        deletedAt: expect.any(Date),
      }),
    });
    expect(mocked.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("fails test-connection when readonly probe fails for unknown reason", async () => {
    mocked.prisma.dataSource.findFirst.mockResolvedValue({
      id: "ds1",
      tenantId: "tenantA",
      type: "mysql",
      host: "127.0.0.1",
      port: 3306,
      username: "ro_user",
      databaseName: "prd02_target_db",
      encryptedSecretPayload: {
        keyId: "v1",
        ct: "x",
        iv: "x",
        tag: "x",
        alg: "aes-256-gcm",
      },
      deletedAt: null,
    });
    mocked.mysqlInfoQuery.mockResolvedValue("8.0.0");
    mocked.verifyMysqlReadOnly.mockRejectedValue(new Error("probe failed unexpectedly"));

    await expect(
      testDataSourceConnection({
        auth: { tenantId: "tenantA", userId: "userA", role: "tenant_admin" },
        dataSourceId: "ds1",
      }),
    ).rejects.toMatchObject({
      errorCode: "connection_failed",
      statusCode: 400,
    });
  });
});
