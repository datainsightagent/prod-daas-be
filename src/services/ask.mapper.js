function mapGenerationLog(row) {
  return {
    log_id: row.logId,
    session_id: row.sessionId,
    message_id: row.messageId,
    tenant_id: row.tenantId,
    step: row.step,
    level: row.level,
    message: row.message,
    sequence_order: row.sequenceOrder,
    created_at: row.createdAt,
  };
}

function mapTokenUsage(row) {
  return {
    usage_id: row.usageId,
    tenant_id: row.tenantId,
    session_type: row.sessionType,
    ask_session_id: row.askSessionId,
    onboarding_session_id: row.onboardingSessionId,
    message_id: row.messageId,
    step: row.step ?? null,
    model: row.model,
    input_tokens: row.inputTokens,
    output_tokens: row.outputTokens,
    total_tokens: row.totalTokens,
    created_at: row.createdAt,
  };
}

export function mapFeedback(row) {
  return {
    feedback_id: row.feedbackId,
    tenant_id: row.tenantId,
    message_id: row.messageId,
    session_id: row.sessionId,
    user_id: row.userId,
    rating: row.rating,
    comment: row.comment ?? null,
    metadata: row.metadata ?? null,
    created_at: row.createdAt,
  };
}

function mapMessage(row) {
  return {
    message_id: row.messageId,
    session_id: row.sessionId,
    tenant_id: row.tenantId,
    type: row.type,
    content: row.content,
    sequence_order: row.sequenceOrder,
    parent_message_id: row.parentMessageId,
    metadata: row.metadata ?? null,
    created_at: row.createdAt,
    generation_logs: row.generationLogs
      ? row.generationLogs.map(mapGenerationLog)
      : undefined,
    token_usage: row.tokenUsageRecords
      ? row.tokenUsageRecords.map(mapTokenUsage)
      : undefined,
    feedback: row.feedbackRecords
      ? row.feedbackRecords.map(mapFeedback)
      : undefined,
  };
}

export function mapAskSessionSummary(row) {
  const lastAssistant = row.messages?.[0];
  return {
    session_id: row.sessionId,
    tenant_id: row.tenantId,
    user_id: row.userId,
    data_source_id: row.dataSourceId,
    question: row.question,
    title: row.title,
    status: row.status,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    last_message_preview: lastAssistant?.content ?? null,
    turn_count: row._count?.messages ?? undefined,
  };
}

export function mapAskSessionDetail(row) {
  return {
    session_id: row.sessionId,
    tenant_id: row.tenantId,
    user_id: row.userId,
    data_source_id: row.dataSourceId,
    question: row.question,
    title: row.title,
    status: row.status,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    messages: row.messages.map(mapMessage),
  };
}

export function mapStreamLogToGenerationLogInput(log, index) {
  return {
    step: log.step?.slice(0, 100) ?? "unknown",
    level: log.level ?? "info",
    message: log.message,
    sequenceOrder: index + 1,
  };
}

export function mapTokenUsageInput(item) {
  const model = item.model?.trim();
  if (!model) {
    return null;
  }

  const step =
    typeof item.step === "string" && item.step.trim()
      ? item.step.trim().slice(0, 100)
      : null;

  return {
    model: model.slice(0, 120),
    step,
    inputTokens: item.input_tokens ?? 0,
    outputTokens: item.output_tokens ?? 0,
    totalTokens: item.total_tokens ?? 0,
  };
}
