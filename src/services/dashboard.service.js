import { assertRequiredRole } from "./auth.service.js";
import { resolveDomainPrismaForAuth } from "../lib/tenantPrismaRouting.js";
import {
  parseCreateDashboardBody,
  parseDashboardIdParam,
  parsePatchDashboardBody,
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
