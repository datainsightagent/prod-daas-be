import { callDaasAi, isDaasAiKbEnabled } from "./daasAi.client.js";
import { logger } from "../lib/logger.js";

/**
 * @param {{ tenantId: string; query: string; limit?: number; types?: string[]; min_similarity?: number }} params
 */
export async function kbRetrieveViaAi({ tenantId, query, limit, types, min_similarity: minSimilarity }) {
  if (!isDaasAiKbEnabled()) {
    return { items: [] };
  }
  return callDaasAi("/v1/kb/retrieve", {
    tenantId,
    body: {
      query,
      limit: limit ?? 10,
      types: types ?? null,
      min_similarity: minSimilarity ?? null,
    },
  });
}

/**
 * @param {{ tenantId: string; collection: 'glossary'|'business_rule'; action: 'upsert'|'delete'; sourceId: string; term?: string; definition?: string; name?: string; expression?: string; description?: string }} params
 */
/**
 * @param {{ tenantId: string; type: 'clarification_qa'|'entity_definition'; sessionId: string; questionId?: string; answerText?: string; entityType?: string; entityName?: string; description?: string }} params
 */
export async function kbSyncUpdateViaAi(params) {
  if (!isDaasAiKbEnabled()) {
    return { status: "skipped", message: "DAAS_AI_KB_ENABLED=false" };
  }
  try {
    return await callDaasAi("/v1/kb/sync-update", {
      tenantId: params.tenantId,
      body: {
        type: params.type,
        tenant_id: params.tenantId,
        session_id: params.sessionId,
        question_id: params.questionId ?? null,
        answer_text: params.answerText ?? null,
        entity_type: params.entityType ?? null,
        entity_name: params.entityName ?? null,
        description: params.description ?? null,
      },
    });
  } catch (err) {
    logger.error({
      event: "kb.sync_update.ai_failed",
      tenantId: params.tenantId,
      type: params.type,
      message: err instanceof Error ? err.message : String(err),
    });
    return { status: "failed", message: err instanceof Error ? err.message : String(err) };
  }
}

export async function kbIndexViaAi(params) {
  if (!isDaasAiKbEnabled()) {
    return { status: "skipped", message: "DAAS_AI_KB_ENABLED=false" };
  }
  try {
    return await callDaasAi("/v1/kb/index", {
      tenantId: params.tenantId,
      body: {
        collection: params.collection,
        action: params.action,
        source_id: params.sourceId,
        term: params.term,
        definition: params.definition,
        name: params.name,
        expression: params.expression,
        description: params.description,
      },
    });
  } catch (err) {
    logger.error({
      event: "kb.index.ai_failed",
      tenantId: params.tenantId,
      collection: params.collection,
      message: err instanceof Error ? err.message : String(err),
    });
    return { status: "failed", message: err instanceof Error ? err.message : String(err) };
  }
}
