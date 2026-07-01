import http from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

vi.mock("../src/services/onboarding.service.js", async () => {
  const actual = await vi.importActual("../src/services/onboarding.service.js");
  return {
    ...actual,
    createOnboardingSession: vi.fn(),
    getOnboardingSession: vi.fn(),
    advanceOnboardingSession: vi.fn(),
    completeOnboardingSession: vi.fn(),
    saveOnboardingTokenUsage: vi.fn(),
    getOnboardingSessionTokenUsageSummary: vi.fn(),
  };
});

import { requestContextMiddleware } from "../src/lib/requestContext.js";
import onboardingRoutes from "../src/routes/onboarding.routes.js";
import * as onboardingService from "../src/services/onboarding.service.js";

function createTestApp() {
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use((req, res, next) => {
    req.auth = {
      userId: "user-1",
      tenantId: "tenant-1",
      role: "tenant_admin",
    };
    next();
  });
  app.use("/onboarding", onboardingRoutes);
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

describe("onboarding.routes PRD-04", () => {
  const app = createTestApp();

  beforeEach(() => {
    vi.mocked(onboardingService.createOnboardingSession).mockReset();
    vi.mocked(onboardingService.getOnboardingSession).mockReset();
    vi.mocked(onboardingService.advanceOnboardingSession).mockReset();
    vi.mocked(onboardingService.completeOnboardingSession).mockReset();
    vi.mocked(onboardingService.saveOnboardingTokenUsage).mockReset();
    vi.mocked(onboardingService.getOnboardingSessionTokenUsageSummary).mockReset();
  });

  it("POST /onboarding/sessions returns 201 with envelope", async () => {
    vi.mocked(onboardingService.createOnboardingSession).mockResolvedValue({
      session_id: "sess-1",
      tenant_id: "tenant-1",
      data_source_id: "ds-1",
      snapshot_id: "snap-1",
      status: "active",
      round_number: 0,
      question_count: 0,
      confidence: null,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const { status, body } = await requestJson(app, "/onboarding/sessions", {
      method: "POST",
      body: JSON.stringify({ data_source_id: "ds-1" }),
    });

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.session_id).toBe("sess-1");
    expect(body.error).toBe(null);
    expect(vi.mocked(onboardingService.createOnboardingSession)).toHaveBeenCalledWith({
      auth: expect.objectContaining({ tenantId: "tenant-1", role: "tenant_admin" }),
      input: { data_source_id: "ds-1" },
    });
  });

  it("POST /onboarding/sessions returns 400 on invalid body", async () => {
    const { status, body } = await requestJson(app, "/onboarding/sessions", {
      method: "POST",
      body: JSON.stringify({}),
    });

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("validation_error");
    expect(onboardingService.createOnboardingSession).not.toHaveBeenCalled();
  });

  it("GET /onboarding/sessions/:id returns 200 with envelope", async () => {
    vi.mocked(onboardingService.getOnboardingSession).mockResolvedValue({
      session_id: "sess-1",
      tenant_id: "tenant-1",
      data_source_id: "ds-1",
      snapshot_id: "snap-1",
      status: "waiting_for_answers",
      round_number: 1,
      question_count: 2,
      confidence: 0.5,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const { status, body } = await requestJson(app, "/onboarding/sessions/sess-1", {
      method: "GET",
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.session_id).toBe("sess-1");
    expect(vi.mocked(onboardingService.getOnboardingSession)).toHaveBeenCalledWith({
      auth: expect.objectContaining({ tenantId: "tenant-1" }),
      sessionId: "sess-1",
    });
  });

  it("GET /onboarding/sessions/:id maps OnboardingServiceError to status", async () => {
    vi.mocked(onboardingService.getOnboardingSession).mockRejectedValue(
      new onboardingService.OnboardingServiceError("missing", 404, "not_found"),
    );

    const { status, body } = await requestJson(app, "/onboarding/sessions/missing", {
      method: "GET",
    });

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("not_found");
  });

  it("POST /onboarding/sessions/:id/advance returns 400 on invalid body", async () => {
    const { status, body } = await requestJson(app, "/onboarding/sessions/sess-1/advance", {
      method: "POST",
      body: JSON.stringify({ answers: [{ question_id: "", answer: "x" }] }),
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("validation_error");
    expect(onboardingService.advanceOnboardingSession).not.toHaveBeenCalled();
  });

  it("POST /onboarding/sessions/:id/advance returns 200 with envelope", async () => {
    vi.mocked(onboardingService.advanceOnboardingSession).mockResolvedValue({
      status: "needs_clarification",
      session: { session_id: "sess-1", status: "waiting_for_answers" },
      questions: [],
    });

    const { status, body } = await requestJson(app, "/onboarding/sessions/sess-1/advance", {
      method: "POST",
      body: JSON.stringify({}),
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("needs_clarification");
  });

  it("POST /onboarding/sessions/:id/complete returns 200 with envelope", async () => {
    vi.mocked(onboardingService.completeOnboardingSession).mockResolvedValue({
      session_id: "sess-1",
      tenant_id: "tenant-1",
      data_source_id: "ds-1",
      snapshot_id: "snap-1",
      status: "complete",
      round_number: 1,
      question_count: 3,
      confidence: 0.9,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed: true,
    });

    const { status, body } = await requestJson(app, "/onboarding/sessions/sess-1/complete", {
      method: "POST",
      body: JSON.stringify({}),
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.completed).toBe(true);
  });

  it("POST /onboarding/sessions/:id/token-usage returns 201 with envelope", async () => {
    vi.mocked(onboardingService.saveOnboardingTokenUsage).mockResolvedValue({
      session_id: "sess-1",
      saved_rows: 2,
    });

    const { status, body } = await requestJson(
      app,
      "/onboarding/sessions/sess-1/token-usage",
      {
        method: "POST",
        body: JSON.stringify({
          token_usage: [
            {
              model: "gpt-4o-mini",
              input_tokens: 100,
              output_tokens: 20,
              total_tokens: 120,
              step: "planner",
            },
          ],
        }),
      },
    );

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.saved_rows).toBe(2);
  });

  it("GET /onboarding/sessions/:id/token-usage-summary returns 200 with envelope", async () => {
    vi.mocked(onboardingService.getOnboardingSessionTokenUsageSummary).mockResolvedValue({
      session_id: "sess-1",
      tenant_id: "tenant-1",
      usage_rows: 1,
      totals: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      by_model: [],
      latest_recorded_at: new Date().toISOString(),
    });

    const { status, body } = await requestJson(
      app,
      "/onboarding/sessions/sess-1/token-usage-summary",
    );

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.usage_rows).toBe(1);
  });
});
