import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  queryRunCreate,
  queryRunUpdate,
  queryResultCreate,
  resolveTenantDataSourceConnectionConfig,
  runMysqlSelectQuery,
} = vi.hoisted(() => ({
  queryRunCreate: vi.fn(),
  queryRunUpdate: vi.fn(),
  queryResultCreate: vi.fn(),
  resolveTenantDataSourceConnectionConfig: vi.fn(),
  runMysqlSelectQuery: vi.fn(),
}));

vi.mock("../src/lib/tenantPrismaRouting.js", () => ({
  resolveDomainPrismaForTenantId: vi.fn(async () => ({
    queryRun: {
      create: queryRunCreate,
      update: queryRunUpdate,
    },
    queryResult: {
      create: queryResultCreate,
    },
  })),
}));

vi.mock("../src/services/dataSource.service.js", () => ({
  DataSourceServiceError: class DataSourceServiceError extends Error {
    constructor(message, statusCode, errorCode) {
      super(message);
      this.statusCode = statusCode;
      this.errorCode = errorCode;
    }
  },
  resolveTenantDataSourceConnectionConfig,
}));

vi.mock("../src/lib/db-connectors/mysql.connector.js", () => ({
  runMysqlSelectQuery,
}));

vi.mock("../src/lib/db-connectors/postgres.connector.js", () => ({
  runPostgresSelectQuery: vi.fn(),
}));

import {
  QueryServiceError,
  runQuery,
  validateQuery,
} from "../src/services/queryExecution.service.js";

describe("queryExecution.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryRunCreate.mockResolvedValue({ runId: "run-1" });
    queryRunUpdate.mockResolvedValue({
      runId: "run-1",
      status: "completed",
      rowCount: 1,
      truncated: false,
      errorCode: null,
      errorMessage: null,
    });
    queryResultCreate.mockResolvedValue({ resultId: "result-1" });
    resolveTenantDataSourceConnectionConfig.mockResolvedValue({
      dataSource: { id: "ds-1", type: "mysql", status: "connected" },
      connection: {
        type: "mysql",
        host: "127.0.0.1",
        port: 3306,
        username: "root",
        password: "secret",
        databaseName: "demo",
      },
    });
    runMysqlSelectQuery.mockResolvedValue({
      schema: [{ name: "customer_count", type: "number" }],
      rows: [{ customer_count: 3 }],
      row_count: 1,
      truncated: false,
    });
  });

  it("validateQuery delegates to read-only validator", async () => {
    const result = await validateQuery({
      sql: "SELECT COUNT(*) AS customer_count FROM customers",
    });
    expect(result.valid).toBe(true);
  });

  it("persists failed run and throws on invalid SQL", async () => {
    await expect(
      runQuery({
        tenantId: "tenant-1",
        dataSourceId: "ds-1",
        sql: "DELETE FROM customers",
      }),
    ).rejects.toBeInstanceOf(QueryServiceError);

    expect(queryRunCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          errorCode: "validation_error",
        }),
      }),
    );
    expect(resolveTenantDataSourceConnectionConfig).not.toHaveBeenCalled();
  });

  it("persists completed run and result on success", async () => {
    const result = await runQuery({
      tenantId: "tenant-1",
      dataSourceId: "ds-1",
      sql: "SELECT COUNT(*) AS customer_count FROM customers",
      rowLimit: 50,
      purpose: "probe",
    });

    expect(result.run_id).toBe("run-1");
    expect(result.status).toBe("completed");
    expect(result.rows).toEqual([{ customer_count: 3 }]);
    expect(queryRunCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "running" }),
      }),
    );
    expect(queryResultCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runId: "run-1",
          tenantId: "tenant-1",
        }),
      }),
    );
  });

  it("persists failed run when execution throws", async () => {
    runMysqlSelectQuery.mockRejectedValue(
      Object.assign(new Error("syntax error near FROM"), {
        code: "ER_PARSE_ERROR",
      }),
    );

    await expect(
      runQuery({
        tenantId: "tenant-1",
        dataSourceId: "ds-1",
        sql: "SELECT COUNT(*) AS customer_count FROM customers",
      }),
    ).rejects.toMatchObject({ errorCode: "syntax_error" });

    expect(queryRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: "run-1" },
        data: expect.objectContaining({
          status: "failed",
          errorCode: "syntax_error",
        }),
      }),
    );
  });
});
