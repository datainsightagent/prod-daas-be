import express from "express";
import {
  deleteWidgetHandler,
  getWidgetDataHandler,
  getWidgetHandler,
} from "../controllers/dashboard.controller.js";

const router = express.Router();

router.get("/:widget_id/data", getWidgetDataHandler);
router.get("/:widget_id", getWidgetHandler);
router.delete("/:widget_id", deleteWidgetHandler);

export default router;
