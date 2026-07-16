import { assertRequiredRole } from "./auth.service.js";
import { logger } from "../lib/logger.js";
import { resolveDomainPrismaForAuth } from "../lib/tenantPrismaRouting.js";
import {
  getOnboardingAgentValidationIssues,
  validateOnboardingAgentResponse,
} from "../contracts/onboardingAgent.contract.js";
import {
  parseOnboardingSessionIdParam,
  parseSaveOnboardingTokenUsageInput,
} from "../contracts/onboarding.contract.js";
import { runOnboardingAgent } from "./onboardingAgent.client.js";
import { kbSyncUpdateViaAi } from "./kbAi.client.js";
import { mapTokenUsageInput } from "./ask.mapper.js";
import {
  buildOnboardingRelayWebSocketUrl,
  relayWebSocketToSse,
} from "./aiStreamRelay.service.js";

const ONBOARDING_TERMINAL_STATUSES = new Set(["complete", "abandoned"]);
const MAX_QUESTIONS_PER_ROUND = 5;
const MAX_TOTAL_QUESTIONS = 30;
const UNKNOWN_ANSWER_TOKENS = new Set(["i don't know", "idk", "unknown", "not sure"]);

export class OnboardingServiceError extends Error {
  constructor(message, statusCode, errorCode) {
    super(message);
    this.name = "OnboardingServiceError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

function mapOnboardingSession(row) {
  return {
    session_id: row.sessionId,
    tenant_id: row.tenantId,
    data_source_id: row.dataSourceId,
    snapshot_id: row.snapshotId,
    status: row.status,
    round_number: row.roundNumber,
    question_count: row.questionCount,
    confidence: row.confidence === null ? null : Number(row.confidence),
    metadata: row.metadata ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

async function getTenantScopedSessionOrFail(sessionId, tenantId, db) {
  const row = await db.onboardingSession.findFirst({
    where: {
      sessionId,
      tenantId,
    },
  });

  if (!row) {
    throw new OnboardingServiceError("Onboarding session not found", 404, "not_found");
  }

  return row;
}

function normalizeUnknownAnswer(rawAnswer) {
  const normalized = String(rawAnswer || "").trim().toLowerCase();
  return UNKNOWN_ANSWER_TOKENS.has(normalized);
}

async function persistKnowledgeFromSuccess({ tx, tenantId, response }) {
  for (const term of response.glossary_terms) {
    const normalized = term.term.toLowerCase();
    await tx.glossaryTerm.upsert({
      where: {
        tenantId_termNormalized: {
          tenantId,
          termNormalized: normalized,
        },
      },
      update: {
        definition: term.definition,
        source: term.source || "agent",
        confidence: term.confidence ?? 0.9,
      },
      create: {
        tenantId,
        term: term.term,
        termNormalized: normalized,
        definition: term.definition,
        source: term.source || "agent",
        confidence: term.confidence ?? 0.9,
      },
    });
  }

  for (const rule of response.business_rules) {
    await tx.businessRule.upsert({
      where: {
        tenantId_name: {
          tenantId,
          name: rule.name,
        },
      },
      update: {
        expression: rule.expression,
        description: rule.description ?? null,
        source: rule.source || "agent",
        confidence: rule.confidence ?? 0.9,
      },
      create: {
        tenantId,
        name: rule.name,
        expression: rule.expression,
        description: rule.description ?? null,
        source: rule.source || "agent",
        confidence: rule.confidence ?? 0.9,
      },
    });
  }

  for (const entity of response.entity_descriptions) {
    const existing = await tx.entityDescription.findFirst({
      where: {
        tenantId,
        entityType: entity.entity_type,
        entityName: entity.entity_name,
      },
      select: { entityId: true },
    });
    if (existing) {
      await tx.entityDescription.update({
        where: { entityId: existing.entityId },
        data: {
          description: entity.description,
          source: entity.source || "agent",
          confidence: entity.confidence ?? 0.9,
          metadata: {
            synced_from: "onboarding_success",
          },
        },
      });
      continue;
    }

    await tx.entityDescription.create({
      data: {
        tenantId,
        entityType: entity.entity_type,
        entityName: entity.entity_name,
        description: entity.description,
        source: entity.source || "agent",
        confidence: entity.confidence ?? 0.9,
        metadata: {
          synced_from: "onboarding_success",
        },
      },
    });
  }
}

function mapAdvanceSuccessPayload(response, session, vectorSync = null) {
  return {
    ...response,
    session: mapOnboardingSession(session),
    vector_sync: vectorSync,
  };
}

function mapAdvanceClarificationPayload(response, session) {
  const questions = response.questions.slice(0, MAX_QUESTIONS_PER_ROUND);
  return {
    ...response,
    questions,
    onboarding_round: response.onboarding_round ?? null,
    round_label: response.round_label ?? null,
    vector_sync: response.vector_sync ?? null,
    round_completed: response.round_completed ?? null,
    session: mapOnboardingSession(session),
  };
}

function mapOnboardingAnswerRow(row) {
  return {
    answer_id: row.answerId,
    session_id: row.sessionId,
    question_id: row.questionId,
    question_text: row.questionText,
    answer_text: row.answerText,
    is_unknown: row.isUnknown,
    created_at: row.createdAt,
  };
}

function mapEntityDescriptionRow(row) {
  return {
    entity_id: row.entityId,
    entity_type: row.entityType,
    entity_name: row.entityName,
    description: row.description,
    source: row.source,
    confidence: Number(row.confidence),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function getOnboardingAnswersByDataSource({ auth, dataSourceId }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);

  const dataSource = await domainPrisma.dataSource.findFirst({
    where: { id: dataSourceId, tenantId: auth.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!dataSource) {
    throw new OnboardingServiceError("Data source not found", 404, "not_found");
  }

  const sessions = await domainPrisma.onboardingSession.findMany({
    where: { tenantId: auth.tenantId, dataSourceId },
    select: { sessionId: true },
  });
  const sessionIds = sessions.map((s) => s.sessionId);
  if (sessionIds.length === 0) return [];

  const rows = await domainPrisma.onboardingAnswer.findMany({
    where: { tenantId: auth.tenantId, sessionId: { in: sessionIds } },
    orderBy: [{ createdAt: "asc" }],
  });

  return rows.map(mapOnboardingAnswerRow);
}

export async function getEntityDescriptionsByDataSource({ auth, dataSourceId }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);

  const dataSource = await domainPrisma.dataSource.findFirst({
    where: { id: dataSourceId, tenantId: auth.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!dataSource) {
    throw new OnboardingServiceError("Data source not found", 404, "not_found");
  }

  const rows = await domainPrisma.entityDescription.findMany({
    where: { tenantId: auth.tenantId },
    orderBy: [{ updatedAt: "desc" }],
  });

  return rows.map(mapEntityDescriptionRow);
}

export async function updateOnboardingAnswer({ auth, answerId, input }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);

  const existing = await domainPrisma.onboardingAnswer.findFirst({
    where: { answerId, tenantId: auth.tenantId },
  });
  if (!existing) {
    throw new OnboardingServiceError("Onboarding answer not found", 404, "not_found");
  }

  const updated = await domainPrisma.onboardingAnswer.update({
    where: { answerId },
    data: {
      answerText: input.answer_text,
      isUnknown: normalizeUnknownAnswer(input.answer_text),
      metadata: {
        ...(existing.metadata || {}),
        last_edited_by: auth.userId,
        last_edited_at: new Date().toISOString(),
      },
    },
  });

  logger.info({
    event: "onboarding.answer.updated",
    answerId,
    tenantId: auth.tenantId,
    userId: auth.userId,
  });

  kbSyncUpdateViaAi({
    tenantId: auth.tenantId,
    type: "clarification_qa",
    sessionId: existing.sessionId,
    questionId: existing.questionId,
    answerText: input.answer_text,
  }).catch((err) => {
    logger.error({
      event: "onboarding.answer.vector_sync_failed",
      answerId,
      message: err instanceof Error ? err.message : String(err),
    });
  });

  return mapOnboardingAnswerRow(updated);
}

export async function updateEntityDescription({ auth, entityId, input }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);

  const existing = await domainPrisma.entityDescription.findFirst({
    where: { entityId, tenantId: auth.tenantId },
  });
  if (!existing) {
    throw new OnboardingServiceError("Entity description not found", 404, "not_found");
  }

  const latestSession = await domainPrisma.onboardingSession.findFirst({
    where: { tenantId: auth.tenantId, status: "complete" },
    orderBy: { updatedAt: "desc" },
    select: { sessionId: true },
  });

  const updated = await domainPrisma.entityDescription.update({
    where: { entityId },
    data: {
      description: input.description,
      metadata: {
        ...(existing.metadata || {}),
        last_edited_by: auth.userId,
        last_edited_at: new Date().toISOString(),
      },
    },
  });

  logger.info({
    event: "onboarding.entity_description.updated",
    entityId,
    tenantId: auth.tenantId,
    userId: auth.userId,
  });

  if (latestSession) {
    kbSyncUpdateViaAi({
      tenantId: auth.tenantId,
      type: "entity_definition",
      sessionId: latestSession.sessionId,
      entityType: existing.entityType,
      entityName: existing.entityName,
      description: input.description,
    }).catch((err) => {
      logger.error({
        event: "onboarding.entity_description.vector_sync_failed",
        entityId,
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return mapEntityDescriptionRow(updated);
}

export async function createOnboardingSession({ auth, input }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);

  const dataSource = await domainPrisma.dataSource.findFirst({
    where: {
      id: input.data_source_id,
      tenantId: auth.tenantId,
      deletedAt: null,
    },
    select: { id: true, onboarded: true },
  });

  if (!dataSource) {
    throw new OnboardingServiceError("Data source not found", 404, "not_found");
  }

  const latestSnapshot = await domainPrisma.schemaSnapshot.findFirst({
    where: {
      tenantId: auth.tenantId,
      dataSourceId: dataSource.id,
      status: "ready",
    },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    select: { snapshotId: true },
  });

  if (!latestSnapshot) {
    throw new OnboardingServiceError(
      "Ready schema snapshot is required before onboarding",
      409,
      "snapshot_not_ready",
    );
  }

  const created = await domainPrisma.onboardingSession.create({
    data: {
      tenantId: auth.tenantId,
      dataSourceId: dataSource.id,
      snapshotId: latestSnapshot.snapshotId,
      status: "active",
      roundNumber: 0,
      questionCount: 0,
      confidence: null,
      metadata: {
        started_by: auth.userId,
      },
    },
  });

  return mapOnboardingSession(created);
}

export async function getOnboardingSession({ auth, sessionId }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const row = await getTenantScopedSessionOrFail(sessionId, auth.tenantId, domainPrisma);
  return mapOnboardingSession(row);
}

export async function completeOnboardingSession({ auth, sessionId }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const row = await getTenantScopedSessionOrFail(sessionId, auth.tenantId, domainPrisma);

  const updated = await domainPrisma.$transaction(async (tx) => {
    const nextSession = await tx.onboardingSession.update({
      where: { sessionId: row.sessionId },
      data: {
        status: "complete",
      },
    });

    await tx.dataSource.update({
      where: { id: row.dataSourceId },
      data: {
        onboarded: true,
      },
    });

    return nextSession;
  });

  return {
    ...mapOnboardingSession(updated),
    completed: true,
  };
}

export async function advanceOnboardingSession({ auth, sessionId, input }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const row = await getTenantScopedSessionOrFail(sessionId, auth.tenantId, domainPrisma);

  if (ONBOARDING_TERMINAL_STATUSES.has(row.status)) {
    throw new OnboardingServiceError(
      "Onboarding session is already finalized",
      409,
      "session_already_finalized",
    );
  }

  if (row.questionCount >= MAX_TOTAL_QUESTIONS) {
    throw new OnboardingServiceError(
      "Onboarding question budget exhausted",
      409,
      "question_cap_exceeded",
    );
  }

  const answers = Array.isArray(input.answers) ? input.answers : [];
  let newlySavedAnswers = [];
  if (answers.length > 0) {
    const lastQuestions = row.metadata?.last_questions ?? [];
    const questionTextMap = Object.fromEntries(
      lastQuestions.map((q) => [q.question_id, q.question]),
    );
    const rows = answers.map((item) => ({
      sessionId: row.sessionId,
      tenantId: auth.tenantId,
      questionId: item.question_id,
      questionText: questionTextMap[item.question_id] || item.question_id,
      answerText: item.answer,
      isUnknown: normalizeUnknownAnswer(item.answer),
      metadata: {
        source: "user",
      },
    }));
    await domainPrisma.onboardingAnswer.createMany({
      data: rows,
    });
    newlySavedAnswers = rows.map((item) => ({
      questionId: item.questionId,
      answerText: item.answerText,
    }));
  }

  const [snapshot, sessionAnswers] = await Promise.all([
    domainPrisma.schemaSnapshot.findFirst({
      where: {
        snapshotId: row.snapshotId,
        tenantId: auth.tenantId,
      },
      select: {
        payload: true,
      },
    }),
    domainPrisma.onboardingAnswer.findMany({
      where: {
        tenantId: auth.tenantId,
        sessionId: row.sessionId,
      },
      orderBy: [{ createdAt: "asc" }],
      select: {
        questionId: true,
        answerText: true,
      },
    }),
  ]);

  if (!snapshot) {
    throw new OnboardingServiceError("Schema snapshot not found", 404, "not_found");
  }

  const agentInput = {
    session: row,
    snapshotPayload: snapshot.payload,
    answeredQuestions: sessionAnswers.map((item) => item.questionId),
    answers: sessionAnswers,
    maxTotalQuestions: MAX_TOTAL_QUESTIONS,
  };

  let rawAgentResponse = await runOnboardingAgent(agentInput);
  let agentResponse = validateOnboardingAgentResponse(rawAgentResponse);
  if (!agentResponse) {
    rawAgentResponse = await runOnboardingAgent(agentInput);
    agentResponse = validateOnboardingAgentResponse(rawAgentResponse);
  }
  if (!agentResponse) {
    logger.warn({
      event: "onboarding.agent.response_invalid",
      sessionId: row.sessionId,
      issues: getOnboardingAgentValidationIssues(rawAgentResponse),
    });
    throw new OnboardingServiceError(
      "Onboarding agent response is malformed",
      502,
      "agent_response_invalid",
    );
  }

  if (agentResponse.status === "needs_clarification") {
    const updated = await domainPrisma.onboardingSession.update({
      where: {
        sessionId: row.sessionId,
      },
      data: {
        status: "waiting_for_answers",
        roundNumber: row.roundNumber + 1,
        questionCount: row.questionCount + agentResponse.questions.length,
        confidence: agentResponse.confidence,
        metadata: {
          ...(row.metadata || {}),
          last_reason: agentResponse.reason,
          last_questions: agentResponse.questions.map((item) => ({
            question_id: item.question_id,
            question: item.question,
            category: item.category ?? null,
            context: item.context ?? null,
            priority: item.priority ?? null,
            suggested_responses: item.suggested_responses ?? null,
            onboarding_round: item.onboarding_round ?? null,
          })),
          last_onboarding_round: agentResponse.onboarding_round ?? null,
        },
      },
    });

    return mapAdvanceClarificationPayload(agentResponse, updated);
  }

  const updated = await domainPrisma.$transaction(async (tx) => {
    await persistKnowledgeFromSuccess({
      tx,
      tenantId: auth.tenantId,
      response: agentResponse,
    });

    const completedSession = await tx.onboardingSession.update({
      where: {
        sessionId: row.sessionId,
      },
      data: {
        status: "complete",
        roundNumber: row.roundNumber + 1,
        questionCount: row.questionCount + answers.length,
        confidence: agentResponse.confidence,
        metadata: {
          ...(row.metadata || {}),
          completed_by: auth.userId,
        },
      },
    });

    await tx.dataSource.update({
      where: {
        id: row.dataSourceId,
      },
      data: {
        onboarded: true,
      },
    });

    return completedSession;
  });

  const vectorSync = agentResponse.vector_sync ?? null;

  return mapAdvanceSuccessPayload(agentResponse, updated, vectorSync);
}

export async function saveOnboardingTokenUsage({ auth, sessionId, body }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);

  const paramParsed = parseOnboardingSessionIdParam({ session_id: sessionId });
  if (!paramParsed.success) {
    throw new OnboardingServiceError("Invalid session id", 400, "validation_error");
  }

  const parsed = parseSaveOnboardingTokenUsageInput(body);
  if (!parsed) {
    throw new OnboardingServiceError(
      "Invalid onboarding token usage payload",
      400,
      "validation_error",
    );
  }

  await getTenantScopedSessionOrFail(
    paramParsed.data.session_id,
    auth.tenantId,
    domainPrisma,
  );

  const usageRows = parsed.token_usage
    .map(mapTokenUsageInput)
    .filter(Boolean)
    .map((item) => ({
      tenantId: auth.tenantId,
      sessionType: "onboarding",
      onboardingSessionId: paramParsed.data.session_id,
      step: item.step,
      model: item.model,
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      totalTokens: item.totalTokens,
    }));

  if (usageRows.length === 0) {
    throw new OnboardingServiceError(
      "No valid token usage rows to save",
      400,
      "validation_error",
    );
  }

  await domainPrisma.tokenUsage.createMany({ data: usageRows });

  logger.info({
    event: "onboarding.token_usage.saved",
    sessionId: paramParsed.data.session_id,
    tenantId: auth.tenantId,
    rows: usageRows.length,
  });

  return {
    session_id: paramParsed.data.session_id,
    saved_rows: usageRows.length,
  };
}

export async function getOnboardingSessionTokenUsageSummary({ auth, sessionId }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);

  const paramParsed = parseOnboardingSessionIdParam({ session_id: sessionId });
  if (!paramParsed.success) {
    throw new OnboardingServiceError("Invalid session id", 400, "validation_error");
  }

  await getTenantScopedSessionOrFail(
    paramParsed.data.session_id,
    auth.tenantId,
    domainPrisma,
  );

  const usageRows = await domainPrisma.tokenUsage.findMany({
    where: {
      tenantId: auth.tenantId,
      sessionType: "onboarding",
      onboardingSessionId: paramParsed.data.session_id,
    },
    orderBy: { createdAt: "asc" },
    select: {
      model: true,
      step: true,
      inputTokens: true,
      outputTokens: true,
      totalTokens: true,
      createdAt: true,
    },
  });

  const byModelMap = new Map();
  const byStepMap = new Map();
  for (const row of usageRows) {
    const current = byModelMap.get(row.model) ?? {
      model: row.model,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      rows: 0,
    };

    current.input_tokens += row.inputTokens;
    current.output_tokens += row.outputTokens;
    current.total_tokens += row.totalTokens;
    current.rows += 1;
    byModelMap.set(row.model, current);

    const stepKey = row.step ?? "unknown";
    const stepCurrent = byStepMap.get(stepKey) ?? {
      step: stepKey,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      rows: 0,
    };
    stepCurrent.input_tokens += row.inputTokens;
    stepCurrent.output_tokens += row.outputTokens;
    stepCurrent.total_tokens += row.totalTokens;
    stepCurrent.rows += 1;
    byStepMap.set(stepKey, stepCurrent);
  }

  const byModel = Array.from(byModelMap.values()).sort(
    (a, b) => b.total_tokens - a.total_tokens,
  );

  const byStep = Array.from(byStepMap.values()).sort(
    (a, b) => b.total_tokens - a.total_tokens,
  );

  const totals = usageRows.reduce(
    (acc, row) => {
      acc.input_tokens += row.inputTokens;
      acc.output_tokens += row.outputTokens;
      acc.total_tokens += row.totalTokens;
      return acc;
    },
    {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    },
  );

  return {
    session_id: paramParsed.data.session_id,
    tenant_id: auth.tenantId,
    usage_rows: usageRows.length,
    totals,
    by_model: byModel,
    by_step: byStep,
    latest_recorded_at:
      usageRows.length > 0 ? usageRows[usageRows.length - 1].createdAt : null,
  };
}

export async function relayOnboardingStream({ auth, sessionId, res }) {
  assertRequiredRole(auth, ["tenant_admin"]);

  const paramParsed = parseOnboardingSessionIdParam({ session_id: sessionId });
  if (!paramParsed.success) {
    throw new OnboardingServiceError("Invalid session id", 400, "validation_error");
  }

  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  await getTenantScopedSessionOrFail(
    paramParsed.data.session_id,
    auth.tenantId,
    domainPrisma,
  );

  const wsUrl = buildOnboardingRelayWebSocketUrl(paramParsed.data.session_id);

  logger.info({
    event: "onboarding.stream_relay.start",
    sessionId: paramParsed.data.session_id,
    tenantId: auth.tenantId,
    userId: auth.userId,
  });

  relayWebSocketToSse(res, wsUrl);
}
