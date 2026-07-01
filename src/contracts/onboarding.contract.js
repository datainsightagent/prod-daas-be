import { z } from "zod";

const answerSchema = z.object({
  question_id: z.string().trim().min(1),
  answer: z.string().trim().min(1),
});

export const createOnboardingSessionSchema = z.object({
  data_source_id: z.string().trim().min(1),
});

export const advanceOnboardingSessionSchema = z.object({
  answers: z.array(answerSchema).max(5).optional(),
});

export function parseCreateOnboardingSessionInput(input) {
  const parsed = createOnboardingSessionSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

export function parseAdvanceOnboardingSessionInput(input) {
  const parsed = advanceOnboardingSessionSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

export const updateOnboardingAnswerSchema = z.object({
  answer_text: z.string().trim().min(1),
});

export const updateEntityDescriptionSchema = z.object({
  description: z.string().trim().min(1).max(2000),
});

export function parseUpdateOnboardingAnswerInput(input) {
  const parsed = updateOnboardingAnswerSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

export function parseUpdateEntityDescriptionInput(input) {
  const parsed = updateEntityDescriptionSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

const onboardingTokenUsageItemSchema = z.object({
  model: z.string().trim().min(1).max(120),
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  total_tokens: z.number().int().min(0),
  step: z.string().trim().min(1).max(100).optional(),
});

export const saveOnboardingTokenUsageSchema = z.object({
  token_usage: z.array(onboardingTokenUsageItemSchema).min(1).max(100),
});

export function parseSaveOnboardingTokenUsageInput(input) {
  const parsed = saveOnboardingTokenUsageSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

export const onboardingSessionIdParamSchema = z.object({
  session_id: z.string().trim().min(1),
});

export function parseOnboardingSessionIdParam(raw) {
  return onboardingSessionIdParamSchema.safeParse(raw);
}
