import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  const prisma = {
    schemaSnapshot: {
      aggregate: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    dataSource: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    schemaChangeEvent: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  return {
    prisma,
    assertRequiredRole: vi.fn(),
    decryptDataSourcePassword: vi.fn(),
    scanMysqlSchema: vi.fn(),
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn(),
  };
});

vi.mock("../src/lib/prisma.js", () => ({
  prisma: mocked.prisma,
}));

vi.mock("../src/services/auth.service.js", () => ({
  assertRequiredRole: mocked.assertRequiredRole,
}));

vi.mock("../src/lib/crypto/dataSourceCrypto.js", () => ({
  decryptDataSourcePassword: mocked.decryptDataSourcePassword,
  encryptDataSourcePassword: vi.fn(),
}));

vi.mock("../src/lib/db-connectors/mysql.connector.js", () => ({
  mysqlInfoQuery: vi.fn(),
  verifyMysqlReadOnly: vi.fn(),
  scanMysqlSchema: mocked.scanMysqlSchema,
}));

vi.mock("../src/lib/db-connectors/postgres.connector.js", () => ({
  postgresInfoQuery: vi.fn(),
  verifyPostgresReadOnly: vi.fn(),
}));

vi.mock("../src/lib/logger.js", () => ({
  logger: {
    info: mocked.loggerInfo,
    warn: mocked.loggerWarn,
    error: vi.fn(),
  },
}));

import {
  acknowledgeSchemaChangeEvent,
  claimNextSchemaScanJob,
  enqueueSchemaScan,
  executeSchemaScanForSnapshot,
  listSchemaChangeEvents,
  scheduleSchemaSnapshotRetry,
} from "../src/services/dataSource.service.js";

describe("schema scan service PRD-03", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.assertRequiredRole.mockImplementation(() => {});
    mocked.decryptDataSourcePassword.mockReturnValue("p@ss");
    mocked.prisma.schemaChangeEvent.createMany.mockResolvedValue({ count: 0 });
    mocked.prisma.schemaChangeEvent.findMany.mockResolvedValue([]);
  });

  it("enqueues queued snapshot with incremented version", async () => {
    mocked.prisma.dataSource.findFirst.mockResolvedValue({
      id: "ds1",
      tenantId: "tenantA",
      type: "mysql",
      deletedAt: null,
    });
    mocked.prisma.schemaSnapshot.aggregate.mockResolvedValue({
      _max: { version: 4 },
    });
    mocked.prisma.schemaSnapshot.create.mockResolvedValue({
      snapshotId: "snap-5",
      status: "queued",
      version: 5,
    });

    const payload = await enqueueSchemaScan({
      auth: { tenantId: "tenantA", userId: "userA", role: "tenant_admin" },
      dataSourceId: "ds1",
      input: { sample_rows_per_table: 3, include_foreign_keys: true },
    });

    expect(payload).toEqual({
      snapshot_id: "snap-5",
      status: "queued",
      version: 5,
    });
    expect(mocked.prisma.schemaSnapshot.create).toHaveBeenCalled();
  });

  it("retries enqueue when version unique constraint races", async () => {
    mocked.prisma.dataSource.findFirst.mockResolvedValue({
      id: "ds1",
      tenantId: "tenantA",
      type: "mysql",
      deletedAt: null,
    });
    mocked.prisma.schemaSnapshot.aggregate
      .mockResolvedValueOnce({ _max: { version: 4 } })
      .mockResolvedValueOnce({ _max: { version: 5 } });
    const raceError = new Error("unique failed");
    raceError.code = "P2002";
    mocked.prisma.schemaSnapshot.create
      .mockRejectedValueOnce(raceError)
      .mockResolvedValueOnce({
        snapshotId: "snap-6",
        status: "queued",
        version: 6,
      });

    const payload = await enqueueSchemaScan({
      auth: { tenantId: "tenantA", userId: "userA", role: "tenant_admin" },
      dataSourceId: "ds1",
      input: { sample_rows_per_table: 3, include_foreign_keys: true },
    });

    expect(payload).toEqual({
      snapshot_id: "snap-6",
      status: "queued",
      version: 6,
    });
    expect(mocked.prisma.schemaSnapshot.create).toHaveBeenCalledTimes(2);
  });

  it("claims next queued scan atomically", async () => {
    mocked.prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        schemaSnapshot: {
          findFirst: vi.fn().mockResolvedValue({
            snapshotId: "snap-1",
            tenantId: "tenantA",
            dataSourceId: "ds1",
            version: 1,
            attemptCount: 0,
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      }),
    );

    const claimed = await claimNextSchemaScanJob();
    expect(claimed).toMatchObject({
      snapshotId: "snap-1",
      tenantId: "tenantA",
      attemptCount: 1,
    });
  });

  it("schedules retry only when attempts remain", async () => {
    mocked.prisma.schemaSnapshot.findFirst.mockResolvedValue({ attemptCount: 1 });
    mocked.prisma.schemaSnapshot.update.mockResolvedValue({});

    const scheduled = await scheduleSchemaSnapshotRetry({
      tenantId: "tenantA",
      snapshotId: "snap-1",
      errorCode: "schema_scan_failed",
      errorMessage: "temporary failure",
      delayMs: 1000,
    });

    expect(scheduled).toBe(true);
    expect(mocked.prisma.schemaSnapshot.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { snapshotId: "snap-1" },
      }),
    );
  });

  it("does not schedule retry when max attempts reached", async () => {
    mocked.prisma.schemaSnapshot.findFirst.mockResolvedValue({ attemptCount: 2 });

    const scheduled = await scheduleSchemaSnapshotRetry({
      tenantId: "tenantA",
      snapshotId: "snap-1",
      errorCode: "schema_scan_failed",
      errorMessage: "failure",
    });

    expect(scheduled).toBe(false);
    expect(mocked.prisma.schemaSnapshot.update).not.toHaveBeenCalled();
  });

  it("executes mysql scan and prunes stale ready snapshots", async () => {
    mocked.prisma.schemaSnapshot.findFirst
      .mockResolvedValueOnce({
        snapshotId: "snap-2",
        tenantId: "tenantA",
        dataSourceId: "ds1",
        version: 12,
        status: "running",
        payload: { include_foreign_keys: true, sample_rows_per_table: 3 },
        lastAttemptAt: new Date(),
        dataSource: {
          id: "ds1",
          type: "mysql",
          host: "127.0.0.1",
          port: 3306,
          username: "u",
          databaseName: "sample_db",
          encryptedSecretPayload: { any: "v" },
        },
      })
      .mockResolvedValueOnce({ status: "running" })
      .mockResolvedValueOnce({
        snapshotId: "snap-1",
        payload: {
          tables: [
            {
              table_name: "customers",
              row_estimate: 1,
              columns: [{ name: "id", type: "int", nullable: false, is_primary_key: true }],
              primary_key: ["id"],
              foreign_keys: [],
              sample_rows: [],
            },
          ],
        },
      });

    mocked.scanMysqlSchema.mockResolvedValue({
      tables: [
        {
          table_name: "customers",
          row_estimate: 1,
          columns: [],
          primary_key: [],
          foreign_keys: [],
          sample_rows: [],
        },
      ],
    });

    mocked.prisma.schemaSnapshot.update.mockResolvedValue({
      snapshotId: "snap-2",
      tenantId: "tenantA",
      dataSourceId: "ds1",
      version: 12,
      status: "ready",
      attemptCount: 1,
      lastAttemptAt: new Date(),
      nextRetryAt: null,
      capturedAt: new Date(),
      errorCode: null,
      errorMessage: null,
      payload: { tables: [] },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mocked.prisma.schemaSnapshot.findMany.mockResolvedValue([
      { snapshotId: "old-1", version: 1 },
    ]);
    mocked.prisma.schemaSnapshot.deleteMany.mockResolvedValue({ count: 1 });
    mocked.prisma.auditLog.create.mockResolvedValue({});

    await executeSchemaScanForSnapshot({
      tenantId: "tenantA",
      snapshotId: "snap-2",
      statusAlreadyRunning: true,
    });

    expect(mocked.scanMysqlSchema).toHaveBeenCalled();
    expect(mocked.prisma.schemaSnapshot.deleteMany).toHaveBeenCalledWith({
      where: {
        snapshotId: {
          in: ["old-1"],
        },
      },
    });
    expect(mocked.prisma.auditLog.create).toHaveBeenCalled();
    expect(mocked.prisma.schemaChangeEvent.createMany).toHaveBeenCalled();
  });

  it("fails scan when datasource is soft-deleted", async () => {
    mocked.prisma.schemaSnapshot.findFirst.mockResolvedValue({
      snapshotId: "snap-deleted",
      tenantId: "tenantA",
      dataSourceId: "ds-deleted",
      version: 3,
      status: "running",
      payload: { include_foreign_keys: true, sample_rows_per_table: 3 },
      lastAttemptAt: new Date(),
      dataSource: {
        id: "ds-deleted",
        type: "mysql",
        deletedAt: new Date(),
      },
    });
    mocked.prisma.schemaSnapshot.update.mockResolvedValue({});

    await expect(
      executeSchemaScanForSnapshot({
        tenantId: "tenantA",
        snapshotId: "snap-deleted",
        statusAlreadyRunning: true,
      }),
    ).rejects.toMatchObject({
      errorCode: "data_source_deleted",
      statusCode: 409,
    });

    expect(mocked.prisma.schemaSnapshot.update).toHaveBeenCalledWith({
      where: { snapshotId: "snap-deleted" },
      data: expect.objectContaining({
        status: "error",
        errorCode: "data_source_deleted",
      }),
    });
  });

  it("lists schema change events for a datasource", async () => {
    mocked.prisma.dataSource.findFirst.mockResolvedValue({
      id: "ds1",
      tenantId: "tenantA",
      deletedAt: null,
    });
    mocked.prisma.schemaChangeEvent.findMany.mockResolvedValue([
      {
        changeEventId: "evt1",
        dataSourceId: "ds1",
        snapshotId: "snap-2",
        previousSnapshotId: "snap-1",
        changeType: "column_removed",
        severity: "critical",
        tableName: "customers",
        columnName: "user_id",
        oldValue: { type: "int" },
        newValue: null,
        acknowledged: false,
        acknowledgedAt: null,
        acknowledgedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const events = await listSchemaChangeEvents({
      auth: { tenantId: "tenantA" },
      dataSourceId: "ds1",
      acknowledged: false,
      limit: 50,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      change_event_id: "evt1",
      change_type: "column_removed",
      severity: "critical",
    });
  });

  it("acknowledges a schema change event", async () => {
    mocked.prisma.schemaChangeEvent.findFirst.mockResolvedValue({
      changeEventId: "evt1",
      tenantId: "tenantA",
    });
    mocked.prisma.schemaChangeEvent.update.mockResolvedValue({
      changeEventId: "evt1",
      dataSourceId: "ds1",
      snapshotId: "snap-2",
      previousSnapshotId: "snap-1",
      changeType: "column_removed",
      severity: "critical",
      tableName: "customers",
      columnName: "user_id",
      oldValue: { type: "int" },
      newValue: null,
      acknowledged: true,
      acknowledgedAt: new Date(),
      acknowledgedBy: "userA",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const event = await acknowledgeSchemaChangeEvent({
      auth: { tenantId: "tenantA", userId: "userA" },
      changeEventId: "evt1",
    });

    expect(event).toMatchObject({
      change_event_id: "evt1",
      acknowledged: true,
      acknowledged_by: "userA",
    });
  });
});
