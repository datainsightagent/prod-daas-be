import { z } from "zod";
import { logger } from "../lib/logger.js";

export const kbCollectionTypeSchema = z.enum([
  "schema_summary",
  "assumptions",
  "clarification_qa_pairs",
  "business_context",
  "entity_definitions",
  "business_rules_enums",
  "glossary",
  "business_rule",
]);

/** Default retrieval mix for planner / SQL gen (PRD-04 notebook). */
export const KB_RETRIEVE_DEFAULT_ONBOARDING_TYPES = [
  "entity_definitions",
  "clarification_qa_pairs",
  "business_rules_enums",
  "business_context",
  "glossary",
  "business_rule",
  "assumptions",
  "schema_summary",
];

const kbRetrieveBodySchema = z.object({
  query: z.string().trim().min(1),
  limit: z.number().int().min(1).max(50).optional(),
  types: z.array(kbCollectionTypeSchema).max(10).optional(),
  /** Cosine-style similarity in [-1, 1]; same semantics as PRD-04 notebook / `min_similarity` on `NumpyVectorStore.search`. Omitted = no threshold (top‑K only). */
  min_similarity: z.number().finite().gte(-1).lte(1).optional(),
});

/**
 * @param {unknown} raw
 * @returns {import("zod").SafeParseReturnType<unknown, z.infer<typeof kbRetrieveBodySchema>>}
 */
export function parseKbRetrieveBody(raw) {
  let body = raw;
  if (body && typeof body === "object" && !Array.isArray(body) && "tenant_id" in body) {
    logger.warn({ event: "kb.retrieve.tenant_id_ignored" });
    const { tenant_id: _ignored, ...rest } = body;
    body = rest;
  }
  return kbRetrieveBodySchema.safeParse(body);
}
