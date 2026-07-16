import { assertRequiredRole } from "./auth.service.js";
import { resolveDomainPrismaForAuth } from "../lib/tenantPrismaRouting.js";
import {
  parseCreateDashboardBody,
  parseDashboardIdParam,
  parsePatchDashboardBody,
  parsePatchDashboardLayoutBody,
} from "../contracts/dashboard.contract.js";

export class DashboardServiceError extends Error {
  constructor(message, statusCode, errorCode) {
    super(message);
    this.name = "DashboardServiceError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

function mapDashboardSummary(row) {
  return {
    dashboard_id: row.dashboardId,
    name: row.name,
    description: row.description,
    status: row.status,
    layout_version: row.layoutVersion,
    created_by: row.createdBy,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function mapWidgetSummary(row) {
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
    data_source_id: row.query?.dataSourceId ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function getOwnedDashboardOrFail({
  domainPrisma,
  dashboardId,
  tenantId,
  includeWidgets = false,
}) {
  const dashboard = await domainPrisma.dashboard.findFirst({
    where: {
      dashboardId,
      tenantId,
      status: "active",
    },
    include: includeWidgets
      ? {
          widgets: {
            where: { status: "active" },
            orderBy: { createdAt: "asc" },
            include: {
              query: {
                select: { dataSourceId: true },
              },
            },
          },
        }
      : undefined,
  });

  if (!dashboard) {
    throw new DashboardServiceError("Dashboard not found", 404, "not_found");
  }

  return dashboard;
}

export async function createDashboard({ auth, body }) {
  assertRequiredRole(auth, ["tenant_admin", "analyst"]);

  const parsed = parseCreateDashboardBody(body);
  if (!parsed.success) {
    throw new DashboardServiceError("Invalid dashboard payload", 400, "validation_error");
  }

  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const row = await domainPrisma.dashboard.create({
    data: {
      tenantId: auth.tenantId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      createdBy: auth.userId,
      status: "active",
    },
  });

  return mapDashboardSummary(row);
}

export async function listDashboards({ auth }) {
  assertRequiredRole(auth, ["tenant_admin", "analyst"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);

  const rows = await domainPrisma.dashboard.findMany({
    where: {
      tenantId: auth.tenantId,
      status: "active",
    },
    orderBy: { updatedAt: "desc" },
  });

  return rows.map(mapDashboardSummary);
}

export async function getDashboard({ auth, dashboardId }) {
  assertRequiredRole(auth, ["tenant_admin", "analyst"]);

  const paramParsed = parseDashboardIdParam({ dashboard_id: dashboardId });
  if (!paramParsed.success) {
    throw new DashboardServiceError("Invalid dashboard id", 400, "validation_error");
  }

  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const dashboard = await getOwnedDashboardOrFail({
    domainPrisma,
    dashboardId: paramParsed.data.dashboard_id,
    tenantId: auth.tenantId,
    includeWidgets: true,
  });

  return {
    ...mapDashboardSummary(dashboard),
    widgets: (dashboard.widgets ?? []).map(mapWidgetSummary),
  };
}

export async function patchDashboard({ auth, dashboardId, body }) {
  assertRequiredRole(auth, ["tenant_admin", "analyst"]);

  const paramParsed = parseDashboardIdParam({ dashboard_id: dashboardId });
  if (!paramParsed.success) {
    throw new DashboardServiceError("Invalid dashboard id", 400, "validation_error");
  }

  const parsed = parsePatchDashboardBody(body);
  if (!parsed.success) {
    throw new DashboardServiceError("Invalid dashboard payload", 400, "validation_error");
  }

  if (parsed.data.name === undefined && parsed.data.description === undefined) {
    throw new DashboardServiceError("No dashboard fields to update", 400, "validation_error");
  }

  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  await getOwnedDashboardOrFail({
    domainPrisma,
    dashboardId: paramParsed.data.dashboard_id,
    tenantId: auth.tenantId,
  });

  const row = await domainPrisma.dashboard.update({
    where: { dashboardId: paramParsed.data.dashboard_id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description }
        : {}),
    },
  });

  return mapDashboardSummary(row);
}

export async function deleteDashboard({ auth, dashboardId }) {
  assertRequiredRole(auth, ["tenant_admin", "analyst"]);

  const paramParsed = parseDashboardIdParam({ dashboard_id: dashboardId });
  if (!paramParsed.success) {
    throw new DashboardServiceError("Invalid dashboard id", 400, "validation_error");
  }

  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const dashboard = await getOwnedDashboardOrFail({
    domainPrisma,
    dashboardId: paramParsed.data.dashboard_id,
    tenantId: auth.tenantId,
  });

  await domainPrisma.$transaction([
    domainPrisma.widget.updateMany({
      where: {
        dashboardId: dashboard.dashboardId,
        tenantId: auth.tenantId,
        status: "active",
      },
      data: { status: "archived" },
    }),
    domainPrisma.dashboard.update({
      where: { dashboardId: dashboard.dashboardId },
      data: { status: "archived" },
    }),
  ]);

  return { dashboard_id: dashboard.dashboardId, status: "archived" };
}

function layoutsOverlap(a, b) {
  const ax1 = a.x;
  const ay1 = a.y;
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx1 = b.x;
  const by1 = b.y;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
}

export async function patchDashboardLayout({ auth, dashboardId, body }) {
  assertRequiredRole(auth, ["tenant_admin", "analyst"]);

  const paramParsed = parseDashboardIdParam({ dashboard_id: dashboardId });
  if (!paramParsed.success) {
    throw new DashboardServiceError("Invalid dashboard id", 400, "validation_error");
  }

  const parsed = parsePatchDashboardLayoutBody(body);
  if (!parsed.success) {
    throw new DashboardServiceError("Invalid layout payload", 400, "validation_error");
  }

  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const dashboard = await getOwnedDashboardOrFail({
    domainPrisma,
    dashboardId: paramParsed.data.dashboard_id,
    tenantId: auth.tenantId,
    includeWidgets: true,
  });

  const updates = parsed.data.widgets;
  if (updates.length === 0) {
    return {
      dashboard_id: dashboard.dashboardId,
      layout_version: dashboard.layoutVersion,
      widgets: (dashboard.widgets ?? []).map((widget) => ({
        widget_id: widget.widgetId,
        layout: widget.layout,
      })),
    };
  }

  const activeById = new Map(
    (dashboard.widgets ?? []).map((widget) => [widget.widgetId, widget]),
  );

  const seen = new Set();
  for (const entry of updates) {
    if (seen.has(entry.widget_id)) {
      throw new DashboardServiceError(
        "Duplicate widget_id in layout payload",
        400,
        "validation_error",
      );
    }
    seen.add(entry.widget_id);

    if (!activeById.has(entry.widget_id)) {
      throw new DashboardServiceError(
        "One or more widgets do not belong to this dashboard",
        400,
        "cross_dashboard_widgets",
      );
    }
  }

  const nextLayouts = new Map(
    (dashboard.widgets ?? []).map((widget) => [widget.widgetId, widget.layout]),
  );
  for (const entry of updates) {
    nextLayouts.set(entry.widget_id, entry.layout);
  }

  const layoutEntries = [...nextLayouts.entries()];
  for (let i = 0; i < layoutEntries.length; i += 1) {
    for (let j = i + 1; j < layoutEntries.length; j += 1) {
      const [, layoutA] = layoutEntries[i];
      const [, layoutB] = layoutEntries[j];
      if (layoutsOverlap(layoutA, layoutB)) {
        throw new DashboardServiceError(
          "Widget layouts must not overlap",
          400,
          "overlapping_layout",
        );
      }
    }
  }

  const updated = await domainPrisma.$transaction(async (tx) => {
    for (const entry of updates) {
      await tx.widget.update({
        where: { widgetId: entry.widget_id },
        data: {
          layout: entry.layout,
          version: { increment: 1 },
        },
      });
    }

    return tx.dashboard.update({
      where: { dashboardId: dashboard.dashboardId },
      data: {
        layoutVersion: { increment: 1 },
      },
      include: {
        widgets: {
          where: { status: "active" },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  });

  return {
    dashboard_id: updated.dashboardId,
    layout_version: updated.layoutVersion,
    widgets: (updated.widgets ?? []).map((widget) => ({
      widget_id: widget.widgetId,
      layout: widget.layout,
    })),
  };
}
