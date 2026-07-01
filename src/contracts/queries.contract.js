import { z } from "zod";

const columnSchemaSchema = z.object({
  name: z.string().trim().min(1),
  type: z
    .enum(["string", "number", "boolean", "date", "unknown"])
    .default("string"),
});

// -- POST /v1/queries/validate (SQL safety only; no data_source_id) --
export const queryValidateBodySchema = z.object({
  sql: z.string().trim().min(1),
});

export function parseQueryValidateBody(raw) {
  return queryValidateBodySchema.safeParse(raw);
}

export const queryValidateResultSchema = z.object({
  valid: z.boolean(),
  errors: z
    .array(
      z.object({
        code: z.string().trim().min(1),
        message: z.string().trim().min(1),
      }),
    )
    .default([]),
});

// POST /v1/queries/run --
export const queryRunPurposeSchema = z.enum(["probe", "render"]);

export const queryRunBodySchema = z.object({
  data_source_id: z.string().trim().min(1),
  sql: z.string().trim().min(1),
  timeout_seconds: z.number().int().min(1).max(120).default(30),
  row_limit: z.number().int().min(1).max(10_000).default(50),
  purpose: queryRunPurposeSchema.default("probe"),
});

export function parseQueryRunBody(raw) {
  return queryRunBodySchema.safeParse(raw);
}

export const queryRunResultSchema = z.object({
  run_id: z.string().trim().min(1),
  status: z.enum(["completed", "failed", "timeout", "cancelled"]),
  schema: z.array(columnSchemaSchema),
  rows: z.array(z.record(z.string(), z.unknown())),
  row_count: z.number().int().min(0),
  truncated: z.boolean(),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
});
