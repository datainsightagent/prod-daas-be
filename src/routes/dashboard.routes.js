import express from "express";
import {
  createDashboardHandler,
  createDashboardWidgetHandler,
  deleteDashboardHandler,
  getDashboardHandler,
  listDashboardsHandler,
  patchDashboardHandler,
} from "../controllers/dashboard.controller.js";

const router = express.Router();

router.post("/", createDashboardHandler);
router.get("/", listDashboardsHandler);
router.get("/:dashboard_id", getDashboardHandler);
router.patch("/:dashboard_id", patchDashboardHandler);
router.delete("/:dashboard_id", deleteDashboardHandler);
router.post("/:dashboard_id/widgets", createDashboardWidgetHandler);

export default router;
