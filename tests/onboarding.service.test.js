import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  const prisma = {
    onboardingSession: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    dataSource: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    schemaSnapshot: {
      findFirst: vi.fn(),
    },
    onboardingAnswer: {
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  return {
    prisma,
    assertRequiredRole: vi.fn(),
    runOnboardingAgent: vi.fn(),
  };
});

vi.mock("../src/lib/prisma.js", () => ({
  prisma: mocked.prisma,
}));

vi.mock("../src/services/auth.service.js", () => ({
  assertRequiredRole: mocked.assertRequiredRole,
}));

vi.mock("../src/services/onboardingAgent.client.js", () => ({
  runOnboardingAgent: mocked.runOnboardingAgent,
}));

import {
  advanceOnboardingSession,
  completeOnboardingSession,
  createOnboardingSession,
  getOnboardingSession,
} from "../src/services/onboarding.service.js";

describe("onboarding.service PRD-04", () => {
  const auth = { tenantId: "tenantA", userId: "userA", role: "tenant_admin" };

  beforeEach(() => {
    vi.clearAllMocks();
    mocked.assertRequiredRole.mockImplementation(() => {});
    mocked.prisma.$transaction.mockImplementation(async (cb) => cb({
      glossaryTerm: { upsert: vi.fn() },
      businessRule: { upsert: vi.fn() },
      entityDescription: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
      onboardingSession: {
        update: vi.fn().mockResolvedValue({
          sessionId: "sess1",
          tenantId: "tenantA",
          dataSourceId: "ds1",
          snapshotId: "snap1",
          status: "complete",
          roundNumber: 1,
          questionCount: 1,
          confidence: 0.9,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
      dataSource: { update: vi.fn().mockResolvedValue({}) },
    }));
  });

  it("creates onboarding session bound to latest ready snapshot", async () => {
    mocked.prisma.dataSource.findFirst.mockResolvedValue({ id: "ds1", onboarded: false });
    mocked.prisma.schemaSnapshot.findFirst.mockResolvedValue({ snapshotId: "snap-ready" });
    mocked.prisma.onboardingSession.create.mockResolvedValue({
      sessionId: "sess-create",
      tenantId: "tenantA",
      dataSourceId: "ds1",
      snapshotId: "snap-ready",
      status: "active",
      roundNumber: 0,
      questionCount: 0,
      confidence: null,
      metadata: { started_by: "userA" },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const output = await createOnboardingSession({
      auth,
      input: { data_source_id: "ds1" },
    });

    expect(output.session_id).toBe("sess-create");
    expect(mocked.prisma.schemaSnapshot.findFirst).toHaveBeenCalled();
  });

  it("returns needs_clarification from advance and updates session state", async () => {
    mocked.prisma.onboardingSession.findFirst.mockResolvedValue({
      sessionId: "sess1",
      tenantId: "tenantA",
      dataSourceId: "ds1",
      snapshotId: "snap1",
      status: "active",
      roundNumber: 0,
      questionCount: 0,
      confidence: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mocked.prisma.schemaSnapshot.findFirst.mockResolvedValue({ payload: { tables: [] } });
    mocked.prisma.onboardingAnswer.findMany.mockResolvedValue([]);
    mocked.runOnboardingAgent.mockResolvedValue({
      status: "needs_clarification",
      step: "onboarding",
      reason: "Need values",
      confidence: 0.62,
      round_number: 1,
      questions: [
        {
          question_id: "enum:orders:status",
          question: "What are statuses?",
          category: "enum_definition",
          context: "Observed values: pending, completed",
          priority: 1,
          suggested_responses: ["Pending", "Completed", "Cancelled"],
        },
      ],
    });
    mocked.prisma.onboardingSession.update.mockResolvedValue({
      sessionId: "sess1",
      tenantId: "tenantA",
      dataSourceId: "ds1",
      snapshotId: "snap1",
      status: "waiting_for_answers",
      roundNumber: 1,
      questionCount: 1,
      confidence: 0.62,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const output = await advanceOnboardingSession({
      auth,
      sessionId: "sess1",
      input: {},
    });

    expect(output.status).toBe("needs_clarification");
    expect(output.questions).toHaveLength(1);
    expect(output.questions[0].suggested_responses).toEqual([
      "Pending",
      "Completed",
      "Cancelled",
    ]);
    expect(mocked.prisma.onboardingSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "waiting_for_answers",
        }),
      }),
    );
  });

  it("returns success from advance and marks datasource onboarded", async () => {
    mocked.prisma.onboardingSession.findFirst.mockResolvedValue({
      sessionId: "sess1",
      tenantId: "tenantA",
      dataSourceId: "ds1",
      snapshotId: "snap1",
      status: "active",
      roundNumber: 0,
      questionCount: 0,
      confidence: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mocked.prisma.onboardingAnswer.createMany.mockResolvedValue({ count: 1 });
    mocked.prisma.schemaSnapshot.findFirst.mockResolvedValue({ payload: { tables: [] } });
    mocked.prisma.onboardingAnswer.findMany.mockResolvedValue([
      { questionId: "enum:orders:status", answerText: "pending, completed" },
    ]);
    mocked.runOnboardingAgent.mockResolvedValue({
      status: "success",
      step: "onboarding",
      confidence: 0.9,
      glossary_terms: [
        { term: "orders.status", definition: "Allowed order status", source: "agent", confidence: 0.9 },
      ],
      business_rules: [
        {
          name: "orders_status_allowed_values",
          expression: "orders.status IN (pending, completed)",
          description: "Rule",
          source: "agent",
          confidence: 0.9,
        },
      ],
      entity_descriptions: [
        {
          entity_type: "table",
          entity_name: "orders",
          description: "Orders table",
          source: "agent",
          confidence: 0.9,
        },
      ],
      assumptions: [{ assumption: "status is controlled vocabulary", confidence: 0.7 }],
      discovered_entities: ["orders"],
      enum_definitions: [
        { entity_name: "orders", field_name: "status", values: ["pending", "completed"], confidence: 0.9 },
      ],
      business_profile: { domain: "tenant_specific", summary: "Done" },
      vector_sync: {
        status: "ok",
        adapter: "pgvector",
        message: "Onboarding knowledge indexed in pgvector for this tenant.",
        collections: { clarification_qa_pairs: 1 },
      },
    });

    const output = await advanceOnboardingSession({
      auth,
      sessionId: "sess1",
      input: {
        answers: [{ question_id: "enum:orders:status", answer: "pending, completed" }],
      },
    });

    expect(output.status).toBe("success");
    expect(output.vector_sync).toMatchObject({ status: "ok" });
    expect(mocked.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("retries once when agent returns malformed then valid success payload", async () => {
    mocked.prisma.onboardingSession.findFirst.mockResolvedValue({
      sessionId: "sess1",
      tenantId: "tenantA",
      dataSourceId: "ds1",
      snapshotId: "snap1",
      status: "active",
      roundNumber: 0,
      questionCount: 0,
      confidence: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mocked.prisma.onboardingAnswer.createMany.mockResolvedValue({ count: 0 });
    mocked.prisma.schemaSnapshot.findFirst.mockResolvedValue({ payload: { tables: [] } });
    mocked.prisma.onboardingAnswer.findMany.mockResolvedValue([]);
    mocked.runOnboardingAgent
      .mockResolvedValueOnce({ status: "success" })
      .mockResolvedValueOnce({
        status: "success",
        step: "onboarding",
        confidence: 0.9,
        glossary_terms: [
          { term: "a.b", definition: "def", source: "agent", confidence: 0.9 },
        ],
        business_rules: [
          {
            name: "r1",
            expression: "true",
            description: "d",
            source: "agent",
            confidence: 0.9,
          },
        ],
        entity_descriptions: [
          {
            entity_type: "table",
            entity_name: "t",
            description: "d",
            source: "agent",
            confidence: 0.9,
          },
        ],
        assumptions: [{ assumption: "a", confidence: 0.7 }],
        discovered_entities: ["t"],
        enum_definitions: [],
        business_profile: { domain: "x", summary: "y" },
      });

    const output = await advanceOnboardingSession({
      auth,
      sessionId: "sess1",
      input: {},
    });

    expect(mocked.runOnboardingAgent).toHaveBeenCalledTimes(2);
    expect(output.status).toBe("success");
  });

  it("fails when agent returns malformed payload twice", async () => {
    mocked.prisma.onboardingSession.findFirst.mockResolvedValue({
      sessionId: "sess1",
      tenantId: "tenantA",
      dataSourceId: "ds1",
      snapshotId: "snap1",
      status: "active",
      roundNumber: 0,
      questionCount: 0,
      confidence: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mocked.prisma.onboardingAnswer.createMany.mockResolvedValue({ count: 0 });
    mocked.prisma.schemaSnapshot.findFirst.mockResolvedValue({ payload: { tables: [] } });
    mocked.prisma.onboardingAnswer.findMany.mockResolvedValue([]);
    mocked.runOnboardingAgent.mockResolvedValue({ status: "success" });

    await expect(
      advanceOnboardingSession({ auth, sessionId: "sess1", input: {} }),
    ).rejects.toMatchObject({ errorCode: "agent_response_invalid" });

    expect(mocked.runOnboardingAgent).toHaveBeenCalledTimes(2);
  });

  it("rejects advance when session is already complete", async () => {
    mocked.prisma.onboardingSession.findFirst.mockResolvedValue({
      sessionId: "sess1",
      tenantId: "tenantA",
      dataSourceId: "ds1",
      snapshotId: "snap1",
      status: "complete",
      roundNumber: 1,
      questionCount: 1,
      confidence: 0.9,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      advanceOnboardingSession({ auth, sessionId: "sess1", input: {} }),
    ).rejects.toMatchObject({ errorCode: "session_already_finalized" });
    expect(mocked.runOnboardingAgent).not.toHaveBeenCalled();
  });

  it("rejects advance when question budget is exhausted", async () => {
    mocked.prisma.onboardingSession.findFirst.mockResolvedValue({
      sessionId: "sess1",
      tenantId: "tenantA",
      dataSourceId: "ds1",
      snapshotId: "snap1",
      status: "active",
      roundNumber: 5,
      questionCount: 30,
      confidence: 0.5,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      advanceOnboardingSession({ auth, sessionId: "sess1", input: {} }),
    ).rejects.toMatchObject({ errorCode: "question_cap_exceeded" });
    expect(mocked.runOnboardingAgent).not.toHaveBeenCalled();
  });

  it("persists isUnknown for I don't know style answers", async () => {
    mocked.prisma.onboardingSession.findFirst.mockResolvedValue({
      sessionId: "sess1",
      tenantId: "tenantA",
      dataSourceId: "ds1",
      snapshotId: "snap1",
      status: "active",
      roundNumber: 0,
      questionCount: 0,
      confidence: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mocked.prisma.schemaSnapshot.findFirst.mockResolvedValue({ payload: { tables: [] } });
    mocked.prisma.onboardingAnswer.findMany.mockResolvedValue([]);
    mocked.runOnboardingAgent.mockResolvedValue({
      status: "needs_clarification",
      step: "onboarding",
      reason: "Need more",
      confidence: 0.6,
      round_number: 1,
      questions: [
        {
          question_id: "enum:t:c",
          question: "Q?",
          category: "enum_definition",
          context: "ctx",
          priority: 1,
        },
      ],
    });
    mocked.prisma.onboardingSession.update.mockResolvedValue({
      sessionId: "sess1",
      tenantId: "tenantA",
      dataSourceId: "ds1",
      snapshotId: "snap1",
      status: "waiting_for_answers",
      roundNumber: 1,
      questionCount: 1,
      confidence: 0.6,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await advanceOnboardingSession({
      auth,
      sessionId: "sess1",
      input: { answers: [{ question_id: "enum:t:c", answer: "I don't know" }] },
    });

    expect(mocked.prisma.onboardingAnswer.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            questionId: "enum:t:c",
            isUnknown: true,
          }),
        ],
      }),
    );
  });

  it("getOnboardingSession enforces tenant_admin and scopes by tenant", async () => {
    mocked.prisma.onboardingSession.findFirst.mockResolvedValue(null);

    await expect(getOnboardingSession({ auth, sessionId: "other" })).rejects.toMatchObject({
      errorCode: "not_found",
    });

    expect(mocked.assertRequiredRole).toHaveBeenCalledWith(auth, ["tenant_admin"]);
    expect(mocked.prisma.onboardingSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenantA", sessionId: "other" }),
      }),
    );
  });

  it("getOnboardingSession returns pending_questions for waiting_for_answers", async () => {
    mocked.prisma.onboardingSession.findFirst.mockResolvedValue({
      sessionId: "sess1",
      tenantId: "tenantA",
      dataSourceId: "ds1",
      snapshotId: "snap1",
      status: "waiting_for_answers",
      roundNumber: 1,
      questionCount: 2,
      confidence: 0.62,
      metadata: {
        last_reason: "Need business context",
        last_questions: [
          {
            question_id: "biz:industry",
            question: "What industry are you in?",
            category: "business_context",
            context: null,
            priority: 1,
          },
          {
            question_id: "biz:core_activity",
            question: "What is your core activity?",
            category: "business_context",
            context: null,
            priority: 2,
          },
        ],
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mocked.prisma.onboardingAnswer.findMany.mockResolvedValue([
      { questionId: "biz:industry" },
    ]);

    const output = await getOnboardingSession({ auth, sessionId: "sess1" });

    expect(output.reason).toBe("Need business context");
    expect(output.pending_questions).toHaveLength(1);
    expect(output.pending_questions[0].question_id).toBe("biz:core_activity");
  });

  it("completeOnboardingSession marks session complete and datasource onboarded", async () => {
    mocked.prisma.onboardingSession.findFirst.mockResolvedValue({
      sessionId: "sess1",
      tenantId: "tenantA",
      dataSourceId: "ds1",
      snapshotId: "snap1",
      status: "waiting_for_answers",
      roundNumber: 1,
      questionCount: 2,
      confidence: 0.5,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mocked.prisma.$transaction.mockImplementation(async (cb) =>
      cb({
        onboardingSession: {
          update: vi.fn().mockResolvedValue({
            sessionId: "sess1",
            tenantId: "tenantA",
            dataSourceId: "ds1",
            snapshotId: "snap1",
            status: "complete",
            roundNumber: 1,
            questionCount: 2,
            confidence: 0.5,
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        },
        dataSource: { update: vi.fn().mockResolvedValue({}) },
      }),
    );

    const out = await completeOnboardingSession({ auth, sessionId: "sess1" });

    expect(out.completed).toBe(true);
    expect(out.status).toBe("complete");
  });
});
