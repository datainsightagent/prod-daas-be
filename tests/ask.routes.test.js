import http from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

vi.mock("../src/services/ask.service.js", async () => {
  const actual = await vi.importActual("../src/services/ask.service.js");
  return {
    ...actual,
    submitMessageFeedback: vi.fn(),
    resumeAsk: vi.fn(),
  };
});

import { requestContextMiddleware } from "../src/lib/requestContext.js";
import askRoutes from "../src/routes/ask.routes.js";
import * as askService from "../src/services/ask.service.js";

function createTestApp() {
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use((req, res, next) => {
    req.auth = {
      userId: "user-1",
      tenantId: "tenant-1",
      role: "analyst",
    };
    next();
  });
  app.use("/ask", askRoutes);
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

describe("ask.routes feedback", () => {
  const app = createTestApp();

  beforeEach(() => {
    vi.mocked(askService.submitMessageFeedback).mockReset();
    vi.mocked(askService.resumeAsk).mockReset();
  });

  it("POST /ask/resume returns 201 with stream credentials", async () => {
    vi.mocked(askService.resumeAsk).mockResolvedValue({
      session_id: "sess-1",
      status: "processing",
      stream_url: "/v1/query/sess-1/stream",
      stream_token: "st_new",
    });

    const { status, body } = await requestJson(app, "/ask/resume", {
      method: "POST",
      body: JSON.stringify({
        session_id: "sess-1",
        answers: [{ question_id: "q1", answer: "Last 30 days" }],
      }),
    });

    expect(status).toBe(201);
    expect(body.data.session_id).toBe("sess-1");
    expect(body.data.stream_token).toBe("st_new");
    expect(askService.resumeAsk).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          session_id: "sess-1",
          answers: [{ question_id: "q1", answer: "Last 30 days" }],
        },
      }),
    );
  });

  it("POST /ask/sessions/:session_id/messages/:message_id/feedback returns 201", async () => {
    vi.mocked(askService.submitMessageFeedback).mockResolvedValue({
      feedback_id: "fb-1",
      tenant_id: "tenant-1",
      message_id: "msg-1",
      session_id: "sess-1",
      user_id: "user-1",
      rating: "up",
      comment: null,
      metadata: { answer_type: "text" },
      created_at: new Date().toISOString(),
    });

    const { status, body } = await requestJson(
      app,
      "/ask/sessions/sess-1/messages/msg-1/feedback",
      {
        method: "POST",
        body: JSON.stringify({ rating: "up", metadata: { answer_type: "text" } }),
      },
    );

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.rating).toBe("up");
  });
});
