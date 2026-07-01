import { z } from "zod";
import { componentSpecSchema } from "./componentSpec.contract.js";
import { datasetSchemaByType } from "./componentDataset.contract.js";

// --- POST /v1/ask ---
export const askBodySchema = z.object({
  question: z.string().trim().min(1).max(2000),
  data_source_id: z.string().trim().min(1),
  session_id: z.string().trim().min(1).optional(),
});

export function parseAskBody(raw) {
  return askBodySchema.safeParse(raw);
}

export const askStartResultSchema = z.object({
  session_id: z.string().trim().min(1),
  status: z.literal("processing"),
  stream_url: z.string().trim().min(1),
  stream_token: z.string().trim().min(1),
});

// --- POST /v1/ask/resume ---
const clarificationAnswerSchema = z.object({
  question_id: z.string().trim().min(1),
  answer: z.string().trim().min(1),
});

export const askResumeBodySchema = z.object({
  session_id: z.string().trim().min(1),
  answers: z.array(clarificationAnswerSchema).min(1).max(2),
});

export function parseAskResumeBody(raw) {
  return askResumeBodySchema.safeParse(raw);
}

// --- POST /v1/ask/:session_id/render ---
export const askRenderBodySchema = z.object({
  sql: z.string().trim().min(1),
  component_spec: componentSpecSchema,
});

export function parseAskRenderBody(raw) {
  return askRenderBodySchema.safeParse(raw);
}

// --- POST /v1/ask/sessions/:session_id/turns ---
const generationLogInputSchema = z.object({
  step: z.string().trim().min(1).max(100),
  level: z.enum(["info", "warn", "error"]).default("info"),
  message: z.string().trim().min(1),
  ts: z.string().optional(),
});

const tokenUsageInputSchema = z.object({
  model: z.string().trim().min(1).max(120),
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  total_tokens: z.number().int().min(0),
  step: z.string().trim().min(1).max(100).optional(),
});

export const saveAskTurnBodySchema = z.object({
  user_message: z.object({
    content: z.string().trim().min(1).max(2000),
  }),
  assistant_message: z
    .object({
      content: z.string().trim().min(1),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  logs: z.array(generationLogInputSchema).default([]),
  token_usage: z.array(tokenUsageInputSchema).default([]),
  status: z.enum(["complete", "failed"]),
  error_message: z.string().trim().max(2000).optional(),
});

export function parseSaveAskTurnBody(raw) {
  return saveAskTurnBodySchema.safeParse(raw);
}

export const askSessionIdParamSchema = z.object({
  session_id: z.string().trim().min(1),
});

export function parseAskSessionIdParam(raw) {
  return askSessionIdParamSchema.safeParse(raw);
}

export const askMessageIdParamSchema = z.object({
  session_id: z.string().trim().min(1),
  message_id: z.string().trim().min(1),
});

export function parseAskMessageIdParam(raw) {
  return askMessageIdParamSchema.safeParse(raw);
}

export const submitMessageFeedbackBodySchema = z.object({
  rating: z.enum(["up", "down"]),
  comment: z.string().trim().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export function parseSubmitMessageFeedbackBody(raw) {
  return submitMessageFeedbackBodySchema.safeParse(raw);
}

export const askRenderMetaSchema = z.object({
  row_count: z.number().int().min(0),
  processing_time_ms: z.number().int().min(0),
});

//build response schema for a give chart type (dataset shape varies)
export function askRenderResultSchemaForType(type) {
  const datasetSchema = datasetSchemaByType[type];
  return z.object({
    component_spec: componentSpecSchema,
    dataset: datasetSchema,
    meta: askRenderMetaSchema,
  });
}
