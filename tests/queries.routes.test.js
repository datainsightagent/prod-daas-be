import http from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

vi.mock("../src/services/queryExecution.service.js", () => ({
  QueryServiceError: class QueryServiceError extends Error {
    constructor(message, statusCode, errorCode) {
      super(message);
      this.statusCode = statusCode;
      this.errorCode = errorCode;
    }
  },
  validateQuery: vi.fn(),
  runQuery: vi.fn(),
}));

import { requestContextMiddleware } from "../src/lib/requestContext.js";
import queriesRoutes from "../src/routes/queries.routes.js";
import * as queryExecution from "../src/services/queryExecution.service.js";

const SERVICE_KEY = "test-service-key";

function createTestApp() {
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use("/queries", queriesRoutes);
  return app;
}

async function requestJson(app, path, init = {}) {
  const server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("queries.routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_SERVICE_API_KEY = SERVICE_KEY;
    delete process.env.AI_SERVICE_API_KEYS_JSON;
  });

  it("returns 401 without x-api-key", async () => {
    const app = createTestApp();
    const res = await requestJson(app, "/queries/run", {
      method: "POST",
      headers: { "x-tenant-id": "tenant-1" },
      body: JSON.stringify({
        data_source_id: "ds-1",
        sql: "SELECT 1",
      }),
    });

    expect(res.status).toBe(401);
    expect(queryExecution.runQuery).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid run body", async () => {
    const app = createTestApp();
    const res = await requestJson(app, "/queries/run", {
      method: "POST",
      headers: {
        "x-api-key": SERVICE_KEY,
        "x-tenant-id": "tenant-1",
      },
      body: JSON.stringify({ sql: "SELECT 1" }),
    });

    expect(res.status).toBe(400);
    expect(queryExecution.runQuery).not.toHaveBeenCalled();
  });

  it("runs query with service auth headers", async () => {
    queryExecution.runQuery.mockResolvedValue({
      run_id: "run-1",
      status: "completed",
      schema: [{ name: "customer_count", type: "number" }],
      rows: [{ customer_count: 3 }],
      row_count: 1,
      truncated: false,
    });

    const app = createTestApp();
    const res = await requestJson(app, "/queries/run", {
      method: "POST",
      headers: {
        "x-api-key": SERVICE_KEY,
        "x-tenant-id": "tenant-1",
      },
      body: JSON.stringify({
        data_source_id: "ds-1",
        sql: "SELECT COUNT(*) AS customer_count FROM customers",
        purpose: "probe",
        row_limit: 50,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(res.body?.data?.run_id).toBe("run-1");
    expect(queryExecution.runQuery).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      dataSourceId: "ds-1",
      sql: "SELECT COUNT(*) AS customer_count FROM customers",
      timeoutSeconds: 30,
      rowLimit: 50,
      purpose: "probe",
    });
  });

  it("validates SQL with service auth headers", async () => {
    queryExecution.validateQuery.mockResolvedValue({
      valid: true,
      errors: [],
    });

    const app = createTestApp();
    const res = await requestJson(app, "/queries/validate", {
      method: "POST",
      headers: {
        "x-api-key": SERVICE_KEY,
        "x-tenant-id": "tenant-1",
      },
      body: JSON.stringify({
        sql: "SELECT 1",
      }),
    });

    expect(res.status).toBe(200);
    expect(res.body?.data?.valid).toBe(true);
    expect(queryExecution.validateQuery).toHaveBeenCalledWith({
      sql: "SELECT 1",
    });
  });

  it("returns 400 when validate body has no sql", async () => {
    const app = createTestApp();
    const res = await requestJson(app, "/queries/validate", {
      method: "POST",
      headers: {
        "x-api-key": SERVICE_KEY,
        "x-tenant-id": "tenant-1",
      },
      body: JSON.stringify({ data_source_id: "ds-1" }),
    });

    expect(res.status).toBe(400);
    expect(queryExecution.validateQuery).not.toHaveBeenCalled();
  });
});
