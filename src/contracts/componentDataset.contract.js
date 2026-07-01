import { z } from "zod";

const seriesSchema = z.object({
  name: z.string().trim().min(1),
  data: z.array(z.number().nullable()),
});

//line / bar / row
export const xyDatasetSchema = z.object({
  categories: z.array(z.union([z.string(), z.number()])),
  series: z.array(seriesSchema).min(1),
});

export const valueDatasetSchema = z.object({
  value: z.number().nullable(),
  label: z.string().trim().min(1),
});

const pieSliceSchema = z.object({
  name: z.string().trim().min(1),
  value: z.number(),
  percentage: z.number(),
});

export const pieDatasetSchema = z.object({
  total: z.number(),
  slices: z.array(pieSliceSchema),
});

const tableColumnSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  type: z.enum(["string", "number", "boolean", "date"]).default("string"),
});

const tablePageSchema = z.object({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).default(11),
  total: z.number().int().min(0),
});

export const tableDatasetSchema = z.object({
  columns: z.array(tableColumnSchema).min(1),
  rows: z.array(z.record(z.string(), z.unknown())),
  page: tablePageSchema,
});

export const datasetSchemaByType = {
  value: valueDatasetSchema,
  line: xyDatasetSchema,
  bar: xyDatasetSchema,
  row: xyDatasetSchema,
  pie: pieDatasetSchema,
  table: tableDatasetSchema,
};

export function parseDataset(type, raw) {
  const schema = datasetSchemaByType[type];
  if (!schema) {
    return {
      success: false,
      error: {
        code: "unsupported_type",
        message: `Unknown chart type: ${type}`,
      },
    };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true, data: result.data };
}

export function datasetJsonSchemaByType() {
  return Object.fromEntries(
    Object.entries(datasetSchemaByType).map(([type, schema]) => [
      type,
      z.toJSONSchema(schema, { name: `${type}Dataset`, target: "draft-7" }),
    ]),
  );
}
