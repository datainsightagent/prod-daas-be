import { z } from "zod";

const confidenceSchema = z.number().min(0).max(1);

const clarificationQuestionSchema = z.object({
  question_id: z.string().trim().min(1),
  question: z.string().trim().min(1),
  category: z.string().trim().min(1).optional(),
  context: z.string().trim().min(1).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  suggested_responses: z
    .array(z.string().trim().min(1))
    .optional(),
  onboarding_round: z.number().int().min(1).max(4).optional(),
});

const vectorSyncSchema = z
  .object({
    status: z.enum(["ok", "skipped", "failed"]),
    adapter: z.string().optional(),
    message: z.string().optional(),
    collections: z.record(z.string(), z.number()).optional(),
    round: z.number().int().min(1).max(4).optional(),
  })
  .optional();

const needsClarificationSchema = z.object({
  status: z.literal("needs_clarification"),
  step: z.literal("onboarding").optional(),
  reason: z.string().trim().min(1),
  confidence: confidenceSchema,
  round_number: z.number().int().min(1),
  /** Agent round 1–4 (business context → entities → rules/enums → KPIs). */
  onboarding_round: z.number().int().min(1).max(4).optional(),
  round_label: z.string().trim().min(1).optional(),
  questions: z.array(clarificationQuestionSchema).max(5),
  vector_sync: vectorSyncSchema,
  round_completed: z.boolean().optional(),
});

const glossaryTermSchema = z.object({
  term: z.string().trim().min(1),
  definition: z.string().trim().min(1),
  source: z.enum(["agent", "user", "user_onboarding"]).optional(),
  confidence: confidenceSchema.optional(),
});

const businessRuleSchema = z.object({
  name: z.string().trim().min(1),
  expression: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  source: z.enum(["agent", "user", "user_onboarding"]).optional(),
  confidence: confidenceSchema.optional(),
});

const entityDescriptionSchema = z.object({
  entity_type: z.enum(["table", "column"]),
  entity_name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  source: z.enum(["agent", "user", "user_onboarding"]).optional(),
  confidence: confidenceSchema.optional(),
});

const assumptionSchema = z.object({
  assumption: z.string().trim().min(1),
  confidence: confidenceSchema.optional(),
});

const enumDefinitionSchema = z.object({
  entity_name: z.string().trim().min(1),
  field_name: z.string().trim().min(1),
  values: z.array(z.string().trim().min(1)).min(1),
  confidence: confidenceSchema.optional(),
});

const successSchema = z.object({
  status: z.literal("success"),
  step: z.literal("onboarding").optional(),
  confidence: confidenceSchema,
  glossary_terms: z.array(glossaryTermSchema),
  business_rules: z.array(businessRuleSchema),
  entity_descriptions: z.array(entityDescriptionSchema),
  assumptions: z.array(assumptionSchema),
  discovered_entities: z.array(z.string().trim().min(1)),
  enum_definitions: z.array(enumDefinitionSchema).optional(),
  business_profile: z
    .object({
      domain: z.string().trim().min(1).optional(),
      summary: z.string().trim().min(1).optional(),
    })
    .optional(),
  vector_sync: vectorSyncSchema,
});

const onboardingAgentResponseSchema = z.union([
  needsClarificationSchema,
  successSchema,
]);

export function validateOnboardingAgentResponse(payload) {
  const parsed = onboardingAgentResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

/** @returns {import("zod").ZodIssue[] | null} */
export function getOnboardingAgentValidationIssues(payload) {
  const parsed = onboardingAgentResponseSchema.safeParse(payload);
  return parsed.success ? null : parsed.error.issues;
}
