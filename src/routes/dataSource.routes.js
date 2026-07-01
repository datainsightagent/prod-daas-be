import express from "express";
import {
  createDataSourceHandler,
  deleteDataSourceHandler,
  enqueueSchemaScanHandler,
  getDataSourceDetailHandler,
  listSchemaChangeEventsHandler,
  listSchemaSnapshotsHandler,
  listDataSourcesHandler,
  testDataSourceConnectionHandler,
} from "../controllers/dataSource.controller.js";

const router = express.Router();

router.post("/", createDataSourceHandler);
router.get("/", listDataSourcesHandler);
router.get("/:id", getDataSourceDetailHandler);
router.post("/:id/test-connection", testDataSourceConnectionHandler);
router.post("/:id/schema-scan", enqueueSchemaScanHandler);
router.get("/:id/schema-snapshots", listSchemaSnapshotsHandler);
router.get("/:id/schema-change-events", listSchemaChangeEventsHandler);
router.delete("/:id", deleteDataSourceHandler);

export default router;
