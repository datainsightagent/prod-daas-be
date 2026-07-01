import { assertRequiredRole } from "./auth.service.js";
import { logger } from "../lib/logger.js";
import { kbRetrieveViaAi } from "./kbAi.client.js";

/**
 * @param {{ auth: { tenantId: string; userId?: string; role?: string }; body: { query: string; limit?: number; types?: string[]; min_similarity?: number } }} args
 */
export async function kbRetrieve({ auth, body }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  const started = Date.now();
  const result = await kbRetrieveViaAi({
    tenantId: auth.tenantId,
    query: body.query,
    limit: body.limit ?? 10,
    types: body.types ?? null,
    min_similarity: body.min_similarity ?? null,
  });
  const items = Array.isArray(result?.items) ? result.items : [];
  const durationMs = Date.now() - started;
  logger.info({
    event: "kb.retrieve",
    tenantId: auth.tenantId,
    durationMs,
    resultCount: items.length,
    min_similarity: body.min_similarity ?? null,
    via: "daas-ai",
  });
  return { items };
}
