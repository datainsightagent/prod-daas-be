import { assertRequiredRole } from "./auth.service.js";
import { resolveDomainPrismaForAuth } from "../lib/tenantPrismaRouting.js";
import {
  askRenderResultSchemaForType,
  parseAskBody,
  parseAskRenderBody,
  parseAskMessageIdParam,
  parseAskResumeBody,
  parseAskSessionIdParam,
  parseSaveAskTurnBody,
  parseSubmitMessageFeedbackBody,
} from "../contracts/ask.contract.js";
import {
  DataSourceServiceError,
  getLatestReadySchemaSnapshotPayload,
  getTenantScopedDataSourceOrFail,
} from "./dataSource.service.js";
import { QueryServiceError, runQuery } from "./queryExecution.service.js";
import { startText2ComponentQuery, resumeText2ComponentQuery } from "./daasAi.client.js";
import { logger } from "../lib/logger.js";
import {
  buildAskRelayWebSocketUrl,
  relayWebSocketToSse,
} from "./aiStreamRelay.service.js";
import {
  mapAskSessionDetail,
  mapAskSessionSummary,
  mapFeedback,
  mapStreamLogToGenerationLogInput,
  mapTokenUsageInput,
} from "./ask.mapper.js";
import { formatData } from "./formatData.service.js";

export class AskServiceError extends Error {
  constructor(message, statusCode, errorCode) {
    super(message);
    this.name = "AskServiceError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

function emptyAiSchemaSnapshot() {
  return { tables: [], columns: [] };
}

function toAiSchemaSnapshotPayload(snapshotPayload) {
  if (
    snapshotPayload &&
    typeof snapshotPayload === "object" &&
    Array.isArray(snapshotPayload.tables)
  ) {
    return snapshotPayload;
  }
  return emptyAiSchemaSnapshot();
}

function rethrowDomainError(err) {
  if (err instanceof DataSourceServiceError) {
    throw new AskServiceError(err.message, err.statusCode, err.errorCode);
  }
  throw err;
}

function buildQueryPayload({ session, dataSource, snapshotPayload, question }) {
  return {
    session_id: session.sessionId,
    tenant_id: session.tenantId,
    data_source_id: session.dataSourceId,
    question,
    db_engine: dataSource.type,
    schema_snapshot: toAiSchemaSnapshotPayload(snapshotPayload),
    clarification_answers: [],
    resume_from: null,
  };
}

async function getOwnedAskSessionOrFail({
  domainPrisma,
  sessionId,
  tenantId,
  userId,
  include,
}) {
  const session = await domainPrisma.askSession.findFirst({
    where: {
      sessionId,
      tenantId,
      userId,
    },
    include,
  });

  if (!session) {
    throw new AskServiceError("Ask session not found", 404, "not_found");
  }

  return session;
}

async function getNextMessageSequence(domainPrisma, sessionId) {
  const latest = await domainPrisma.askMessage.findFirst({
    where: { sessionId },
    orderBy: { sequenceOrder: "desc" },
    select: { sequenceOrder: true },
  });
  return (latest?.sequenceOrder ?? 0) + 1;
}

export async function startAsk({ auth, body }) {
  assertRequiredRole(auth, ["tenant_admin", "analyst"]);

  const parsed = parseAskBody(body);
  if (!parsed.success) {
    throw new AskServiceError("Invalid ask payload", 400, "validation_error");
  }

  const {
    question,
    data_source_id: dataSourceId,
    session_id: existingSessionId,
  } = parsed.data;
  const domainPrisma = await resolveDomainPrismaForAuth(auth);

  let dataSource;
  try {
    dataSource = await getTenantScopedDataSourceOrFail(
      dataSourceId,
      auth.tenantId,
      domainPrisma,
    );
  } catch (err) {
    rethrowDomainError(err);
  }

  const snapshotPayload = await getLatestReadySchemaSnapshotPayload(
    domainPrisma,
    auth.tenantId,
    dataSource.id,
  );

  let session;

  if (existingSessionId) {
    session = await getOwnedAskSessionOrFail({
      domainPrisma,
      sessionId: existingSessionId,
      tenantId: auth.tenantId,
      userId: auth.userId,
    });

    if (session.dataSourceId !== dataSource.id) {
      throw new AskServiceError(
        "Session belongs to a different data source",
        400,
        "validation_error",
      );
    }

    session = await domainPrisma.askSession.update({
      where: { sessionId: session.sessionId },
      data: {
        question,
        status: "processing",
      },
    });
  } else {
    session = await domainPrisma.askSession.create({
      data: {
        tenantId: auth.tenantId,
        userId: auth.userId,
        dataSourceId: dataSource.id,
        question,
        title: question.length > 200 ? `${question.slice(0, 197)}...` : question,
        status: "processing",
      },
    });
  }

  const queryPayload = buildQueryPayload({
    session,
    dataSource,
    snapshotPayload,
    question,
  });

  let aiResult;
  try {
    aiResult = await startText2ComponentQuery(queryPayload, auth.tenantId);
  } catch (err) {
    await domainPrisma.askSession.update({
      where: { sessionId: session.sessionId },
      data: { status: "failed" },
    });

    logger.warn({
      event: "ask.ai_start_failed",
      sessionId: session.sessionId,
      message: err instanceof Error ? err.message : String(err),
    });

    throw new AskServiceError(
      "Failed to start analytics session with AI service",
      502,
      "ai_unavailable",
    );
  }

  return {
    session_id: aiResult.session_id ?? session.sessionId,
    status: "processing",
    stream_url: aiResult.stream_url,
    stream_token: aiResult.stream_token,
  };
}

export async function resumeAsk({ auth, body }) {
  assertRequiredRole(auth, ["tenant_admin", "analyst"]);

  const parsed = parseAskResumeBody(body);
  if (!parsed.success) {
    throw new AskServiceError("Invalid ask resume payload", 400, "validation_error");
  }

  const { session_id: sessionId, answers } = parsed.data;
  const domainPrisma = await resolveDomainPrismaForAuth(auth);

  const session = await getOwnedAskSessionOrFail({
    domainPrisma,
    sessionId,
    tenantId: auth.tenantId,
    userId: auth.userId,
  });

  await domainPrisma.askSession.update({
    where: { sessionId: session.sessionId },
    data: { status: "processing" },
  });

  let aiResult;
  try {
    aiResult = await resumeText2ComponentQuery(
      {
        session_id: session.sessionId,
        tenant_id: auth.tenantId,
        answers,
      },
      auth.tenantId,
    );
  } catch (err) {
    await domainPrisma.askSession.update({
      where: { sessionId: session.sessionId },
      data: { status: "failed" },
    });

    logger.warn({
      event: "ask.ai_resume_failed",
      sessionId: session.sessionId,
      message: err instanceof Error ? err.message : String(err),
    });

    throw new AskServiceError(
      "Failed to resume analytics session with AI service",
      502,
      "ai_unavailable",
    );
  }

  return {
    session_id: aiResult.session_id ?? session.sessionId,
    status: "processing",
    stream_url: aiResult.stream_url,
    stream_token: aiResult.stream_token,
  };
}

export async function listAskSessions({ auth }) {
  assertRequiredRole(auth, ["tenant_admin", "analyst"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);

  const rows = await domainPrisma.askSession.findMany({
    where: {
      tenantId: auth.tenantId,
      userId: auth.userId,
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 50,
    include: {
      messages: {
        where: { type: "assistant" },
        orderBy: { sequenceOrder: "desc" },
        take: 1,
        select: { content: true },
      },
      _count: {
        select: {
          messages: {
            where: { type: "user" },
          },
        },
      },
    },
  });

  return rows.map(mapAskSessionSummary);
}

export async function getAskSession({ auth, sessionId }) {
  assertRequiredRole(auth, ["tenant_admin", "analyst"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);

  const session = await getOwnedAskSessionOrFail({
    domainPrisma,
    sessionId,
    tenantId: auth.tenantId,
    userId: auth.userId,
    include: {
      messages: {
        orderBy: { sequenceOrder: "asc" },
        include: {
          generationLogs: {
            orderBy: { sequenceOrder: "asc" },
          },
          tokenUsageRecords: {
            where: { sessionType: "ask" },
            orderBy: { createdAt: "asc" },
          },
          feedbackRecords: {
            where: { userId: auth.userId },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  return mapAskSessionDetail(session);
}

export async function submitMessageFeedback({ auth, sessionId, messageId, body }) {
  assertRequiredRole(auth, ["tenant_admin", "analyst"]);

  const paramParsed = parseAskMessageIdParam({
    session_id: sessionId,
    message_id: messageId,
  });
  if (!paramParsed.success) {
    throw new AskServiceError("Invalid session or message id", 400, "validation_error");
  }

  const parsed = parseSubmitMessageFeedbackBody(body);
  if (!parsed.success) {
    throw new AskServiceError("Invalid feedback payload", 400, "validation_error");
  }

  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  await getOwnedAskSessionOrFail({
    domainPrisma,
    sessionId: paramParsed.data.session_id,
    tenantId: auth.tenantId,
    userId: auth.userId,
  });

  const message = await domainPrisma.askMessage.findFirst({
    where: {
      messageId: paramParsed.data.message_id,
      sessionId: paramParsed.data.session_id,
      tenantId: auth.tenantId,
      type: "assistant",
    },
  });

  if (!message) {
    throw new AskServiceError("Assistant message not found", 404, "not_found");
  }

  const { rating, comment, metadata } = parsed.data;

  const row = await domainPrisma.feedback.upsert({
    where: {
      messageId_userId: {
        messageId: message.messageId,
        userId: auth.userId,
      },
    },
    update: {
      rating,
      comment: comment ?? null,
      metadata: metadata ?? undefined,
    },
    create: {
      tenantId: auth.tenantId,
      messageId: message.messageId,
      sessionId: paramParsed.data.session_id,
      userId: auth.userId,
      rating,
      comment: comment ?? null,
      metadata: metadata ?? undefined,
    },
  });

  logger.info({
    event: "ask.feedback.saved",
    sessionId: paramParsed.data.session_id,
    messageId: message.messageId,
    tenantId: auth.tenantId,
    userId: auth.userId,
    rating,
  });

  return mapFeedback(row);
}

export async function getAskSessionTokenUsageSummary({ auth, sessionId }) {
  assertRequiredRole(auth, ["tenant_admin", "analyst"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);

  const session = await getOwnedAskSessionOrFail({
    domainPrisma,
    sessionId,
    tenantId: auth.tenantId,
    userId: auth.userId,
  });

  const usageRows = await domainPrisma.tokenUsage.findMany({
    where: {
      tenantId: auth.tenantId,
      sessionType: "ask",
      askSessionId: session.sessionId,
    },
    orderBy: { createdAt: "asc" },
    select: {
      model: true,
      inputTokens: true,
      outputTokens: true,
      totalTokens: true,
      createdAt: true,
    },
  });

  const byModelMap = new Map();
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
  }

  const byModel = Array.from(byModelMap.values()).sort(
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
    session_id: session.sessionId,
    tenant_id: session.tenantId,
    usage_rows: usageRows.length,
    totals,
    by_model: byModel,
    latest_recorded_at:
      usageRows.length > 0 ? usageRows[usageRows.length - 1].createdAt : null,
  };
}

export async function renderAskSession({ auth, sessionId, body }) {
  assertRequiredRole(auth, ["tenant_admin", "analyst"]);

  const paramParsed = parseAskSessionIdParam({ session_id: sessionId });
  if (!paramParsed.success) {
    throw new AskServiceError("Invalid session id", 400, "validation_error");
  }

  const parsed = parseAskRenderBody(body);
  if (!parsed.success) {
    throw new AskServiceError("Invalid render payload", 400, "validation_error");
  }

  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const session = await getOwnedAskSessionOrFail({
    domainPrisma,
    sessionId: paramParsed.data.session_id,
    tenantId: auth.tenantId,
    userId: auth.userId,
  });

  const { sql, component_spec: componentSpec } = parsed.data;
  const startedAt = Date.now();

  let queryResult;
  try {
    queryResult = await runQuery({
      tenantId: auth.tenantId,
      dataSourceId: session.dataSourceId,
      sql,
      purpose: "render",
      rowLimit: 1000,
    });
  } catch (error) {
    if (error instanceof QueryServiceError) {
      throw new AskServiceError(error.message, error.statusCode, error.errorCode);
    }
    throw error;
  }

  const dataset = formatData(
    componentSpec,
    queryResult.rows ?? [],
    queryResult.schema ?? [],
    { rowCount: queryResult.row_count ?? 0 },
  );

  const payload = {
    component_spec: componentSpec,
    dataset,
    meta: {
      row_count: queryResult.row_count ?? 0,
      processing_time_ms: Date.now() - startedAt,
    },
  };

  const resultValidation = askRenderResultSchemaForType(componentSpec.type).safeParse(payload);
  if (!resultValidation.success) {
    throw new AskServiceError("Failed to format rendered dataset", 500, "format_error");
  }

  return resultValidation.data;
}

export async function saveAskTurn({ auth, sessionId, body }) {
  assertRequiredRole(auth, ["tenant_admin", "analyst"]);

  const paramParsed = parseAskSessionIdParam({ session_id: sessionId });
  if (!paramParsed.success) {
    throw new AskServiceError("Invalid session id", 400, "validation_error");
  }

  const parsed = parseSaveAskTurnBody(body);
  if (!parsed.success) {
    throw new AskServiceError("Invalid turn payload", 400, "validation_error");
  }

  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const session = await getOwnedAskSessionOrFail({
    domainPrisma,
    sessionId: paramParsed.data.session_id,
    tenantId: auth.tenantId,
    userId: auth.userId,
  });

  const {
    user_message: userMessage,
    assistant_message: assistantMessage,
    logs,
    token_usage: tokenUsage,
    status,
    error_message: errorMessage,
  } = parsed.data;

  const nextSequence = await getNextMessageSequence(
    domainPrisma,
    session.sessionId,
  );

  const result = await domainPrisma.$transaction(async (tx) => {
    const userRow = await tx.askMessage.create({
      data: {
        sessionId: session.sessionId,
        tenantId: auth.tenantId,
        type: "user",
        content: userMessage.content,
        sequenceOrder: nextSequence,
      },
    });

    let assistantRow = null;
    if (assistantMessage?.content) {
      assistantRow = await tx.askMessage.create({
        data: {
          sessionId: session.sessionId,
          tenantId: auth.tenantId,
          type: "assistant",
          content: assistantMessage.content,
          sequenceOrder: nextSequence + 1,
          parentMessageId: userRow.messageId,
          metadata: assistantMessage.metadata ?? undefined,
        },
      });
    } else if (status === "failed" && errorMessage) {
      assistantRow = await tx.askMessage.create({
        data: {
          sessionId: session.sessionId,
          tenantId: auth.tenantId,
          type: "assistant",
          content: errorMessage,
          sequenceOrder: nextSequence + 1,
          parentMessageId: userRow.messageId,
          metadata: { failed: true },
        },
      });
    }

    if (assistantRow && logs.length > 0) {
      await tx.askGenerationLog.createMany({
        data: logs.map((log, index) => {
          const mapped = mapStreamLogToGenerationLogInput(log, index);
          return {
            sessionId: session.sessionId,
            messageId: assistantRow.messageId,
            tenantId: auth.tenantId,
            step: mapped.step,
            level: mapped.level,
            message: mapped.message,
            sequenceOrder: mapped.sequenceOrder,
          };
        }),
      });
    }

    if (assistantRow && tokenUsage.length > 0) {
      const usageRows = tokenUsage
        .map(mapTokenUsageInput)
        .filter(Boolean)
        .map((item) => ({
          tenantId: auth.tenantId,
          sessionType: "ask",
          askSessionId: session.sessionId,
          messageId: assistantRow.messageId,
          model: item.model,
          inputTokens: item.inputTokens,
          outputTokens: item.outputTokens,
          totalTokens: item.totalTokens,
        }));

      if (usageRows.length > 0) {
        await tx.tokenUsage.createMany({ data: usageRows });
      }
    }

    await tx.askSession.update({
      where: { sessionId: session.sessionId },
      data: {
        status,
        question: userMessage.content,
      },
    });

    return {
      user_message_id: userRow.messageId,
      assistant_message_id: assistantRow?.messageId ?? null,
    };
  });

  return {
    session_id: session.sessionId,
    status,
    ...result,
  };
}

export async function relayAskStream({ auth, sessionId, streamUrl, streamToken, res }) {
  assertRequiredRole(auth, ["tenant_admin", "analyst"]);

  const paramParsed = parseAskSessionIdParam({ session_id: sessionId });
  if (!paramParsed.success) {
    throw new AskServiceError("Invalid session id", 400, "validation_error");
  }

  const normalizedStreamUrl = String(streamUrl || "").trim();
  const normalizedStreamToken = String(streamToken || "").trim();
  if (!normalizedStreamUrl || !normalizedStreamToken) {
    throw new AskServiceError(
      "stream_url and stream_token are required",
      400,
      "validation_error",
    );
  }

  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  await getOwnedAskSessionOrFail({
    domainPrisma,
    sessionId: paramParsed.data.session_id,
    tenantId: auth.tenantId,
    userId: auth.userId,
  });

  const wsUrl = buildAskRelayWebSocketUrl(normalizedStreamUrl, normalizedStreamToken);

  logger.info({
    event: "ask.stream_relay.start",
    sessionId: paramParsed.data.session_id,
    tenantId: auth.tenantId,
    userId: auth.userId,
  });

  relayWebSocketToSse(res, wsUrl);
}
