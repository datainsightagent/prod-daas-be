import express from "express";
import {
  deleteWidgetHandler,
  getWidgetDataHandler,
  getWidgetHandler,
  patchWidgetHandler,
} from "../controllers/dashboard.controller.js";

const router = express.Router();

router.get("/:widget_id/data", getWidgetDataHandler);
router.get("/:widget_id", getWidgetHandler);
router.patch("/:widget_id", patchWidgetHandler);
router.delete("/:widget_id", deleteWidgetHandler);

export default router;
