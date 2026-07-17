import { assertRequiredRole } from "./auth.service.js";
import { resolveDomainPrismaForAuth } from "../lib/tenantPrismaRouting.js";
import {
  parseCreateWidgetBody,
  parseDashboardIdParam,
  parsePatchWidgetBody,
  parseWidgetIdParam,
  widgetDataResultSchemaForType,
} from "../contracts/dashboard.contract.js";
import {
  DashboardServiceError,
  getOwnedDashboardOrFail,
} from "./dashboard.service.js";
import {
  DataSourceServiceError,
  getTenantScopedDataSourceOrFail,
} from "./dataSource.service.js";
import { QueryServiceError, runQuery } from "./queryExecution.service.js";
import { formatData } from "./formatData.service.js";
import { parseComponentSpec } from "../contracts/componentSpec.contract.js";

export class WidgetServiceError extends Error {
  constructor(message, statusCode, errorCode) {
    super(message);
    this.name = "WidgetServiceError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

const DEFAULT_LAYOUT_BY_TYPE = {
  value: { x: 0, y: 0, w: 3, h: 2 },
  table: { x: 0, y: 0, w: 8, h: 6 },
  bar: { x: 0, y: 0, w: 6, h: 4 },
  line: { x: 0, y: 0, w: 6, h: 4 },
  row: { x: 0, y: 0, w: 6, h: 4 },
  pie: { x: 0, y: 0, w: 6, h: 4 },
};

function mapWidget(row) {
  return {
    widget_id: row.widgetId,
    dashboard_id: row.dashboardId,
    title: row.title,
    type: row.type,
    query_id: row.queryId,
    component_spec: row.componentSpec,
    layout: row.layout,
    status: row.status,
    version: row.version,
    source_ask_session_id: row.sourceAskSessionId ?? null,
    source_message_id: row.sourceMessageId ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function layoutBottom(layout) {
  const y = Number(layout?.y ?? 0);
  const h = Number(layout?.h ?? 0);
  return y + h;
}

function resolveNextLayout(existingLayouts, requested, type) {
  const base = {
    ...(DEFAULT_LAYOUT_BY_TYPE[type] ?? DEFAULT_LAYOUT_BY_TYPE.bar),
    ...(requested ?? {}),
  };

  const maxBottom = existingLayouts.reduce(
    (max, layout) => Math.max(max, layoutBottom(layout)),
    0,
  );

  const hasCollision = existingLayouts.some((layout) => {
    const ax1 = Number(layout?.x ?? 0);
    const ay1 = Number(layout?.y ?? 0);
    const ax2 = ax1 + Number(layout?.w ?? 1);
    const ay2 = ay1 + Number(layout?.h ?? 1);
    const bx1 = base.x;
    const by1 = base.y;
    const bx2 = bx1 + base.w;
    const by2 = by1 + base.h;
    return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
  });

  if (!hasCollision) {
    return base;
  }

  return {
    ...base,
    x: 0,
    y: maxBottom,
  };
}

async function getOwnedWidgetOrFail({ domainPrisma, widgetId, tenantId }) {
  const widget = await domainPrisma.widget.findFirst({
    where: {
      widgetId,
      tenantId,
      status: "active",
    },
    include: {
      query: true,
      dashboard: true,
    },
  });

  if (!widget || widget.dashboard.status !== "active") {
    throw new WidgetServiceError("Widget not found", 404, "not_found");
  }

  return widget;
}

/**
 * Optional chat provenance. Validates session/message belong to this tenant.
 * Returns nulls when omitted.
 */
async function resolveSourceProvenance({
  domainPrisma,
  tenantId,
  sourceAskSessionId,
  sourceMessageId,
}) {
  const sessionId =
    typeof sourceAskSessionId === "string" && sourceAskSessionId.trim()
      ? sourceAskSessionId.trim()
      : null;
  const messageId =
    typeof sourceMessageId === "string" && sourceMessageId.trim()
      ? sourceMessageId.trim()
      : null;

  if (!sessionId && !messageId) {
    return { sourceAskSessionId: null, sourceMessageId: null };
  }

  if (sessionId) {
    const session = await domainPrisma.askSession.findFirst({
      where: { sessionId, tenantId },
      select: { sessionId: true },
    });
    if (!session) {
      throw new WidgetServiceError(
        "source_ask_session_id not found for this tenant",
        400,
        "invalid_source_session",
      );
    }
  }

  if (messageId) {
    const message = await domainPrisma.askMessage.findFirst({
      where: { messageId, tenantId },
      select: { messageId: true, sessionId: true },
    });
    if (!message) {
      throw new WidgetServiceError(
        "source_message_id not found for this tenant",
        400,
        "invalid_source_message",
      );
    }
    if (sessionId && message.sessionId !== sessionId) {
      throw new WidgetServiceError(
        "source_message_id does not belong to source_ask_session_id",
        400,
        "source_message_session_mismatch",
      );
    }
    if (!sessionId) {
      return {
        sourceAskSessionId: message.sessionId,
        sourceMessageId: message.messageId,
      };
    }
  }

  return {
    sourceAskSessionId: sessionId,
    sourceMessageId: messageId,
  };
}

export async function createDashboardWidget({ auth, dashboardId, body }) {
  assertRequiredRole(auth, ["tenant_admin", "analyst"]);

  const paramParsed = parseDashboardIdParam({ dashboard_id: dashboardId });
  if (!paramParsed.success) {
    throw new WidgetServiceError("Invalid dashboard id", 400, "validation_error");
  }

  const parsed = parseCreateWidgetBody(body);
  if (!parsed.success) {
    throw new WidgetServiceError("Invalid widget payload", 400, "validation_error");
  }

  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const dashboard = await getOwnedDashboardOrFail({
    domainPrisma,
    dashboardId: paramParsed.data.dashboard_id,
    tenantId: auth.tenantId,
    includeWidgets: true,
  });

  try {
    await getTenantScopedDataSourceOrFail(
      parsed.data.data_source_id,
      auth.tenantId,
      domainPrisma,
    );
  } catch (error) {
    if (error instanceof DataSourceServiceError) {
      throw new WidgetServiceError(error.message, error.statusCode, error.errorCode);
    }
    throw error;
  }

  const provenance = await resolveSourceProvenance({
    domainPrisma,
    tenantId: auth.tenantId,
    sourceAskSessionId: parsed.data.source_ask_session_id,
    sourceMessageId: parsed.data.source_message_id,
  });

  const componentSpec = parsed.data.component_spec;
  const title =
    parsed.data.title?.trim() ||
    (typeof componentSpec.title === "string" ? componentSpec.title.trim() : "Widget");

  const existingLayouts = (dashboard.widgets ?? []).map((widget) => widget.layout);
  const layout = resolveNextLayout(
    existingLayouts,
    parsed.data.layout ?? componentSpec.layout,
    componentSpec.type,
  );

  const queryName = title.slice(0, 120);

  const result = await domainPrisma.$transaction(async (tx) => {
    const queryDef = await tx.queryDefinition.create({
      data: {
        tenantId: auth.tenantId,
        dataSourceId: parsed.data.data_source_id,
        sql: parsed.data.sql,
        name: queryName,
        createdBy: auth.userId,
        status: "active",
      },
    });

    const widget = await tx.widget.create({
      data: {
        tenantId: auth.tenantId,
        dashboardId: dashboard.dashboardId,
        title: title.slice(0, 500),
        type: componentSpec.type,
        queryId: queryDef.queryId,
        componentSpec,
        layout,
        status: "active",
        version: 1,
        sourceAskSessionId: provenance.sourceAskSessionId,
        sourceMessageId: provenance.sourceMessageId,
      },
    });

    await tx.dashboard.update({
      where: { dashboardId: dashboard.dashboardId },
      data: { updatedAt: new Date() },
    });

    return widget;
  });

  return mapWidget(result);
}

export async function patchWidget({ auth, widgetId, body }) {
  assertRequiredRole(auth, ["tenant_admin", "analyst"]);

  const paramParsed = parseWidgetIdParam({ widget_id: widgetId });
  if (!paramParsed.success) {
    throw new WidgetServiceError("Invalid widget id", 400, "validation_error");
  }

  const parsed = parsePatchWidgetBody(body);
  if (!parsed.success) {
    throw new WidgetServiceError("Invalid widget payload", 400, "validation_error");
  }

  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const widget = await getOwnedWidgetOrFail({
    domainPrisma,
    widgetId: paramParsed.data.widget_id,
    tenantId: auth.tenantId,
  });

  if (widget.query.status !== "active") {
    throw new WidgetServiceError(
      "Widget query is archived; recreate the widget",
      409,
      "query_archived",
    );
  }

  const componentSpec = parsed.data.component_spec;
  const title =
    parsed.data.title?.trim() ||
    (typeof componentSpec.title === "string" ? componentSpec.title.trim() : widget.title);

  const hasProvenancePatch =
    parsed.data.source_ask_session_id !== undefined ||
    parsed.data.source_message_id !== undefined;

  let provenance = {
    sourceAskSessionId: widget.sourceAskSessionId ?? null,
    sourceMessageId: widget.sourceMessageId ?? null,
  };

  if (hasProvenancePatch) {
    provenance = await resolveSourceProvenance({
      domainPrisma,
      tenantId: auth.tenantId,
      sourceAskSessionId:
        parsed.data.source_ask_session_id !== undefined
          ? parsed.data.source_ask_session_id
          : widget.sourceAskSessionId,
      sourceMessageId:
        parsed.data.source_message_id !== undefined
          ? parsed.data.source_message_id
          : widget.sourceMessageId,
    });
  }

  const updated = await domainPrisma.$transaction(async (tx) => {
    await tx.queryDefinition.update({
      where: { queryId: widget.queryId },
      data: {
        sql: parsed.data.sql,
        name: title.slice(0, 120),
      },
    });

    const next = await tx.widget.update({
      where: { widgetId: widget.widgetId },
      data: {
        title: title.slice(0, 500),
        type: componentSpec.type,
        componentSpec,
        version: { increment: 1 },
        sourceAskSessionId: provenance.sourceAskSessionId,
        sourceMessageId: provenance.sourceMessageId,
      },
    });

    await tx.dashboard.update({
      where: { dashboardId: widget.dashboardId },
      data: { updatedAt: new Date() },
    });

    return next;
  });

  return {
    ...mapWidget(updated),
    data_source_id: widget.query.dataSourceId,
    sql: parsed.data.sql,
  };
}

export async function getWidget({ auth, widgetId }) {
  assertRequiredRole(auth, ["tenant_admin", "analyst"]);

  const paramParsed = parseWidgetIdParam({ widget_id: widgetId });
  if (!paramParsed.success) {
    throw new WidgetServiceError("Invalid widget id", 400, "validation_error");
  }

  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const widget = await getOwnedWidgetOrFail({
    domainPrisma,
    widgetId: paramParsed.data.widget_id,
    tenantId: auth.tenantId,
  });

  return {
    ...mapWidget(widget),
    data_source_id: widget.query.dataSourceId,
    sql: widget.query.sql,
  };
}

export async function deleteWidget({ auth, widgetId }) {
  assertRequiredRole(auth, ["tenant_admin", "analyst"]);

  const paramParsed = parseWidgetIdParam({ widget_id: widgetId });
  if (!paramParsed.success) {
    throw new WidgetServiceError("Invalid widget id", 400, "validation_error");
  }

  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const widget = await getOwnedWidgetOrFail({
    domainPrisma,
    widgetId: paramParsed.data.widget_id,
    tenantId: auth.tenantId,
  });

  await domainPrisma.widget.update({
    where: { widgetId: widget.widgetId },
    data: { status: "archived" },
  });

  return { widget_id: widget.widgetId, status: "archived" };
}

export async function getWidgetData({ auth, widgetId }) {
  assertRequiredRole(auth, ["tenant_admin", "analyst"]);

  const paramParsed = parseWidgetIdParam({ widget_id: widgetId });
  if (!paramParsed.success) {
    throw new WidgetServiceError("Invalid widget id", 400, "validation_error");
  }

  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const widget = await getOwnedWidgetOrFail({
    domainPrisma,
    widgetId: paramParsed.data.widget_id,
    tenantId: auth.tenantId,
  });

  if (widget.query.status !== "active") {
    throw new WidgetServiceError(
      "Widget query is archived; recreate the widget",
      409,
      "query_archived",
    );
  }

  const parsedSpec = parseComponentSpec(widget.componentSpec);
  if (!parsedSpec.success) {
    throw new WidgetServiceError(
      "Stored component_spec is invalid",
      500,
      "invalid_component_spec",
    );
  }

  const componentSpec = parsedSpec.data;
  const sql =
    typeof widget.query.sql === "string" && widget.query.sql.trim().length > 0
      ? widget.query.sql
      : componentSpec.query.sql;

  const startedAt = Date.now();

  let queryResult;
  try {
    queryResult = await runQuery({
      tenantId: auth.tenantId,
      dataSourceId: widget.query.dataSourceId,
      sql,
      purpose: "render",
      rowLimit: 1000,
    });
  } catch (error) {
    if (error instanceof QueryServiceError) {
      throw new WidgetServiceError(error.message, error.statusCode, error.errorCode);
    }
    throw error;
  }

  const dataset = formatData(
    componentSpec,
    queryResult.rows ?? [],
    queryResult.schema ?? [],
    { rowCount: queryResult.row_count ?? 0 },
  );

  const payload = {
    component_spec: componentSpec,
    dataset,
    meta: {
      row_count: queryResult.row_count ?? 0,
      processing_time_ms: Date.now() - startedAt,
      widget_id: widget.widgetId,
    },
  };

  const validated = widgetDataResultSchemaForType(componentSpec.type).safeParse(payload);
  if (!validated.success) {
    throw new WidgetServiceError("Failed to format widget dataset", 500, "format_error");
  }

  return validated.data;
}

export function rethrowAsWidgetError(error) {
  if (error instanceof DashboardServiceError) {
    throw new WidgetServiceError(error.message, error.statusCode, error.errorCode);
  }
  throw error;
}
