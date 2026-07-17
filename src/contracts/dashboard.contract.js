import { z } from "zod";
import { componentSpecSchema } from "./componentSpec.contract.js";
import { datasetSchemaByType } from "./componentDataset.contract.js";

const layoutSchema = z
  .object({
    x: z.number().int().min(0).default(0),
    y: z.number().int().min(0).default(0),
    w: z.number().int().min(1).max(12).default(6),
    h: z.number().int().min(1).default(4),
  })
  .superRefine((layout, ctx) => {
    if (layout.x + layout.w > 12) {
      ctx.addIssue({
        code: "custom",
        message: "layout.x + layout.w must be <= 12",
        path: ["w"],
      });
    }
  });

export const createDashboardBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
});

export function parseCreateDashboardBody(raw) {
  return createDashboardBodySchema.safeParse(raw);
}

export const patchDashboardBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
});

export function parsePatchDashboardBody(raw) {
  return patchDashboardBodySchema.safeParse(raw);
}

export const patchDashboardLayoutBodySchema = z.object({
  widgets: z
    .array(
      z.object({
        widget_id: z.string().trim().min(1),
        layout: layoutSchema,
      }),
    )
    .default([]),
});

export function parsePatchDashboardLayoutBody(raw) {
  return patchDashboardLayoutBodySchema.safeParse(raw);
}

export const dashboardIdParamSchema = z.object({
  dashboard_id: z.string().trim().min(1),
});

export function parseDashboardIdParam(raw) {
  return dashboardIdParamSchema.safeParse(raw);
}

export const widgetIdParamSchema = z.object({
  widget_id: z.string().trim().min(1),
});

export function parseWidgetIdParam(raw) {
  return widgetIdParamSchema.safeParse(raw);
}

export const createWidgetBodySchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  component_spec: componentSpecSchema,
  sql: z.string().trim().min(1),
  data_source_id: z.string().trim().min(1),
  layout: layoutSchema.optional(),
  source_ask_session_id: z.string().trim().min(1).optional().nullable(),
  source_message_id: z.string().trim().min(1).optional().nullable(),
});

export function parseCreateWidgetBody(raw) {
  return createWidgetBodySchema.safeParse(raw);
}

export const patchWidgetBodySchema = z.object({
  component_spec: componentSpecSchema,
  sql: z.string().trim().min(1),
  title: z.string().trim().min(1).max(500).optional(),
  source_ask_session_id: z.string().trim().min(1).optional().nullable(),
  source_message_id: z.string().trim().min(1).optional().nullable(),
});

export function parsePatchWidgetBody(raw) {
  return patchWidgetBodySchema.safeParse(raw);
}

export function widgetDataResultSchemaForType(type) {
  const datasetSchema = datasetSchemaByType[type];
  return z.object({
    component_spec: componentSpecSchema,
    dataset: datasetSchema,
    meta: z.object({
      row_count: z.number().int().min(0),
      processing_time_ms: z.number().int().min(0),
      widget_id: z.string().trim().min(1),
    }),
  });
}
