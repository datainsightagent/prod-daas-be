import { z } from "zod";

const MAX_SAMPLE_ROWS_PER_TABLE = 10;
const DEFAULT_SAMPLE_ROWS_PER_TABLE = 3;

const foreignKeySchema = z.object({
  column: z.string().min(1),
  ref_table: z.string().min(1),
  ref_column: z.string().min(1),
  ref_table_missing: z.boolean().optional(),
});

const columnSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  nullable: z.boolean(),
  is_primary_key: z.boolean(),
});

const tableSchema = z.object({
  table_name: z.string().min(1),
  row_estimate: z.number().int().nonnegative().nullable(),
  columns: z.array(columnSchema),
  primary_key: z.array(z.string().min(1)),
  foreign_keys: z.array(foreignKeySchema),
  sample_rows: z.array(z.record(z.string(), z.unknown())),
});

export const schemaSnapshotPayloadSchema = z.object({
  tables: z.array(tableSchema),
});

export class SchemaSnapshotContractError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = "SchemaSnapshotContractError";
    this.details = details;
  }
}

export function normalizeSampleRowLimit(value) {
  if (value == null) {
    return DEFAULT_SAMPLE_ROWS_PER_TABLE;
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    throw new SchemaSnapshotContractError(
      "sample_rows_per_table must be an integer",
    );
  }
  if (numeric < 0 || numeric > MAX_SAMPLE_ROWS_PER_TABLE) {
    throw new SchemaSnapshotContractError(
      `sample_rows_per_table must be between 0 and ${MAX_SAMPLE_ROWS_PER_TABLE}`,
    );
  }
  return numeric;
}

export function validateSchemaSnapshotPayload(payload) {
  const parsed = schemaSnapshotPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SchemaSnapshotContractError(
      "Snapshot payload does not match schema snapshot contract",
      parsed.error.flatten(),
    );
  }
  return parsed.data;
}

export const schemaSnapshotContractLimits = {
  MAX_SAMPLE_ROWS_PER_TABLE,
  DEFAULT_SAMPLE_ROWS_PER_TABLE,
};
