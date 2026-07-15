import { errorResponse, successResponse } from "../utils/apiEnvelope.js";
import {
  DashboardServiceError,
  createDashboard,
  deleteDashboard,
  getDashboard,
  listDashboards,
  patchDashboard,
  patchDashboardLayout,
} from "../services/dashboard.service.js";
import {
  WidgetServiceError,
  createDashboardWidget,
  deleteWidget,
  getWidget,
  getWidgetData,
} from "../services/widget.service.js";

function handleDashboardError(res, error, operationName) {
  if (
    error instanceof DashboardServiceError ||
    error instanceof WidgetServiceError
  ) {
    return res
      .status(error.statusCode)
      .json(errorResponse(error.errorCode, error.message));
  }

  console.error(`${operationName} failed:`, error);
  return res.status(500).json(
    errorResponse(
      "internal_error",
      `Unexpected error occurred while processing ${operationName}`,
    ),
  );
}

export async function createDashboardHandler(req, res) {
  try {
    const payload = await createDashboard({
      auth: req.auth,
      body: req.body,
    });
    return res.status(201).json(successResponse(payload));
  } catch (error) {
    return handleDashboardError(res, error, "dashboard_create");
  }
}

export async function listDashboardsHandler(req, res) {
  try {
    const payload = await listDashboards({ auth: req.auth });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleDashboardError(res, error, "dashboard_list");
  }
}

export async function getDashboardHandler(req, res) {
  try {
    const payload = await getDashboard({
      auth: req.auth,
      dashboardId: req.params.dashboard_id,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleDashboardError(res, error, "dashboard_get");
  }
}

export async function patchDashboardHandler(req, res) {
  try {
    const payload = await patchDashboard({
      auth: req.auth,
      dashboardId: req.params.dashboard_id,
      body: req.body,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleDashboardError(res, error, "dashboard_patch");
  }
}

export async function deleteDashboardHandler(req, res) {
  try {
    const payload = await deleteDashboard({
      auth: req.auth,
      dashboardId: req.params.dashboard_id,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleDashboardError(res, error, "dashboard_delete");
  }
}

export async function patchDashboardLayoutHandler(req, res) {
  try {
    const payload = await patchDashboardLayout({
      auth: req.auth,
      dashboardId: req.params.dashboard_id,
      body: req.body,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleDashboardError(res, error, "dashboard_layout_patch");
  }
}

export async function createDashboardWidgetHandler(req, res) {
  try {
    const payload = await createDashboardWidget({
      auth: req.auth,
      dashboardId: req.params.dashboard_id,
      body: req.body,
    });
    return res.status(201).json(successResponse(payload));
  } catch (error) {
    return handleDashboardError(res, error, "dashboard_widget_create");
  }
}

export async function getWidgetHandler(req, res) {
  try {
    const payload = await getWidget({
      auth: req.auth,
      widgetId: req.params.widget_id,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleDashboardError(res, error, "widget_get");
  }
}

export async function deleteWidgetHandler(req, res) {
  try {
    const payload = await deleteWidget({
      auth: req.auth,
      widgetId: req.params.widget_id,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleDashboardError(res, error, "widget_delete");
  }
}

export async function getWidgetDataHandler(req, res) {
  try {
    const payload = await getWidgetData({
      auth: req.auth,
      widgetId: req.params.widget_id,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleDashboardError(res, error, "widget_data");
  }
}
