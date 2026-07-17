import { z } from "zod";

export const componentTypeSchema = z.enum([
  "value",
  "line",
  "bar",
  "row",
  "pie",
  "table",
]);

export const SPEC_VERSION = 2;

const layoutSchema = z.object({
  x: z.number().int().min(0).default(0),
  y: z.number().int().min(0).default(0),
  w: z.number().int().min(1).max(12).default(6),
  h: z.number().int().min(1).default(4),
});

const querySchema = z.object({
  query_id: z.string().trim().min(1).optional(),
  sql: z.string().trim().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
});

//shared config fragments (line / bar)
const seriesDisplaySchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  display_type: z.enum(["line", "area", "bar"]).optional(),
  line_style: z.enum(["straight", "curved", "step"]).optional(),
  show_dots: z.enum(["auto", "on", "off"]).optional(),
  axis: z.enum(["auto", "left", "right"]).default("auto"),
});

const axesSchema = z.object({
  x_scale: z.enum(["ordinal", "linear", "timeseries"]).default("ordinal"),
  y_scale: z.literal("linear").default("linear"),
  show_x_axis: z.boolean().default(true),
  show_y_axis: z.boolean().default(true),
  auto_y_range: z.boolean().default(true),
  y_min: z.number().nullable().default(null),
  y_max: z.number().nullable().default(null),
});

const labelsSchema = z.object({
  show_x_label: z.boolean().default(true),
  x_label: z.string().optional(),
  show_y_label: z.boolean().default(true),
  y_label: z.string().optional(),
});

const goalLineSchema = z.object({
  enabled: z.boolean().default(false),
  value: z.number().nullable().default(null),
});

//per type data_map + config
const valueDataMapSchema = z.object({
  value_field: z.string().trim().min(1),
  label: z.string().trim().min(1),
});

const valueConfigSchema = z.object({
  style: z
    .enum(["normal", "percent", "currency", "scientific"])
    .default("normal"),
  separator_style: z.string().default("100,000.00"),
  min_decimal_places: z.number().int().min(0).default(0),
  multiply_by: z.number().default(1),
  prefix: z.string().default(""),
  suffix: z.string().default(""),
});

const xyDataMapSchema = z.object({
  x_field: z.string().trim().min(1),
  y_field: z.string().trim().min(1),
  series_field: z.string().trim().min(1).nullable().default(null),
});

const lineDisplaySchema = z.object({
  goal_line: goalLineSchema.default({ enabled: false, value: null }),
  show_values: z.boolean().default(false),
  series: z.array(seriesDisplaySchema).min(1),
  replace_missing_values: z
    .enum(["none", "zero", "linear_interpolated"])
    .default("linear_interpolated"),
});

const lineConfigSchema = z.object({
  display: lineDisplaySchema,
  axes: axesSchema.default({}),
  labels: labelsSchema.default({}),
});

const barDisplaySchema = z.object({
  stacking: z.enum(["none", "stack", "stack_100"]).default("none"),
  goal_line: goalLineSchema.default({ enabled: false, value: null }),
  show_values: z.boolean().default(false),
  series: z.array(seriesDisplaySchema).min(1),
});

const barConfigSchema = z.object({
  display: barDisplaySchema,
  axes: axesSchema.default({}),
  labels: labelsSchema.default({}),
});

const rowDataMapSchema = z.object({
  y_field: z.string().trim().min(1),
  x_field: z.string().trim().min(1),
});

const rowDisplaySchema = z.object({
  series: z.array(seriesDisplaySchema).min(1),
});

const rowConfigSchema = z.object({
  display: rowDisplaySchema,
});

const pieDataMapSchema = z.object({
  dimension: z.string().trim().min(1),
  measure: z.string().trim().min(1),
});

const pieConfigSchema = z.object({
  show_legend: z.boolean().default(true),
  show_percentages_in_legend: z.boolean().default(true),
  minimum_slice_percentage: z.number().min(0).max(100).default(2.5),
  colors: z.record(z.string(), z.string()).default({}),
});

const tableDataMapSchema = z.object({
  columns: z.array(z.string().trim().min(1)).min(1),
});

const tableColumnConfigSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  visible: z.boolean().default(true),
  align: z.enum(["left", "center", "right"]).default("left"),
  format: z
    .object({
      separator_style: z.string().optional(),
      min_decimal_places: z.number().int().min(0).optional(),
    })
    .optional(),
});

const conditionalFormattingSchema = z.object({
  columns: z.array(z.string().trim().min(1)).min(1),
  operator: z.enum([
    "is_equal_to",
    "is_greater_than",
    "is_less_than",
    "is_between",
    "contains",
  ]),
  value: z.union([z.number(), z.string()]),
  value_to: z.union([z.number(), z.string()]).optional(),
  background_color: z.string().optional(),
  highlight_whole_row: z.boolean().default(false),
});

const tableConfigSchema = z.object({
  columns: z.array(tableColumnConfigSchema).min(1),
  conditional_formatting: z.array(conditionalFormattingSchema).default([]),
  pagination: z.object({
    page_size: z.number().int().min(1).default(11),
  }),
});

//envelope + discriminated union
const envelopeBase = {
  spec_version: z.literal(SPEC_VERSION),
  id: z.string().trim().min(1).optional(),
  // Accept full AI titles; widgets wrap in the UI instead of truncating.
  title: z.string().trim().min(1).max(500),
  query: querySchema,
  layout: layoutSchema.default({ x: 0, y: 0, w: 6, h: 4 }),
};

const valueComponentSpecSchema = z.object({
  ...envelopeBase,
  type: z.literal("value"),
  data_map: valueDataMapSchema,
  config: valueConfigSchema.default({}),
});

const lineComponentSpecSchema = z.object({
  ...envelopeBase,
  type: z.literal("line"),
  data_map: xyDataMapSchema,
  config: lineConfigSchema,
});

const barComponentSpecSchema = z.object({
  ...envelopeBase,
  type: z.literal("bar"),
  data_map: xyDataMapSchema,
  config: barConfigSchema,
});

const rowComponentSpecSchema = z.object({
  ...envelopeBase,
  type: z.literal("row"),
  data_map: rowDataMapSchema,
  config: rowConfigSchema,
});

const pieComponentSpecSchema = z.object({
  ...envelopeBase,
  type: z.literal("pie"),
  data_map: pieDataMapSchema,
  config: pieConfigSchema.default({}),
});

const tableComponentSpecSchema = z.object({
  ...envelopeBase,
  type: z.literal("table"),
  data_map: tableDataMapSchema,
  config: tableConfigSchema,
});

export const componentSpecSchema = z.discriminatedUnion("type", [
  valueComponentSpecSchema,
  lineComponentSpecSchema,
  barComponentSpecSchema,
  rowComponentSpecSchema,
  pieComponentSpecSchema,
  tableComponentSpecSchema,
]);

export function parseComponentSpec(raw) {
  return componentSpecSchema.safeParse(raw);
}

export function parseComponentSpecOrThrow(raw) {
  return componentSpecSchema.parse(raw);
}

//export JSON Schema for AI team (zod 4 native)
export function componentSpecJsonSchema() {
  return z.toJSONSchema(componentSpecSchema, {
    name: "ComponentSpec",
    target: "draft-7",
  });
}
