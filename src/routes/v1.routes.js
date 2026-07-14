import express from "express";
import { tenantsMe, usersMe } from "../controllers/auth.controller.js";
import {
  acknowledgeSchemaChangeEventHandler,
  getSchemaSnapshotHandler,
  getDataSourceDetailHandler,
  listDataSourcesHandler,
  listSchemaSnapshotsHandler,
} from "../controllers/dataSource.controller.js";
import dataSourceRoutes from "./dataSource.routes.js";
import businessRulesRoutes from "./businessRules.routes.js";
import entitiesRoutes from "./entities.routes.js";
import glossaryRoutes from "./glossary.routes.js";
import kbRoutes from "./kb.routes.js";
import onboardingRoutes from "./onboarding.routes.js";
import askRoutes from "./ask.routes.js";
import dashboardRoutes from "./dashboard.routes.js";
import widgetRoutes from "./widget.routes.js";
import queriesRoutes from "./queries.routes.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireUserOrServiceAuth } from "../middleware/requireUserOrServiceAuth.js";
import { successResponse } from "../utils/apiEnvelope.js";

const router = express.Router();

router.get(
  "/data-sources",
  requireUserOrServiceAuth({ scope: "datasource:read" }),
  listDataSourcesHandler,
);
router.get(
  "/schema-snapshots/:snapshotId",
  requireUserOrServiceAuth({ scope: "snapshot:read" }),
  getSchemaSnapshotHandler,
);
router.get(
  "/data-sources/:id",
  requireUserOrServiceAuth({ scope: "datasource:read" }),
  getDataSourceDetailHandler,
);
router.get(
  "/data-sources/:id/schema-snapshots",
  requireUserOrServiceAuth({ scope: "snapshot:read" }),
  listSchemaSnapshotsHandler,
);

router.use("/queries", queriesRoutes);

router.use(requireAuth);

/**
 * Minimal protected route to verify JWT middleware (remove or replace later).
 */
router.get("/ping", (req, res) => {
  return res.status(200).json(
    successResponse({
      ok: true,
      auth: {
        user_id: req.auth.userId,
        tenant_id: req.auth.tenantId,
        role: req.auth.role,
      },
    }),
  );
});

router.get("/users/me", usersMe);
router.get("/tenants/me", tenantsMe);
router.post(
  "/schema-change-events/:eventId/acknowledge",
  acknowledgeSchemaChangeEventHandler,
);
router.use("/data-sources", dataSourceRoutes);
router.use("/business-rules", businessRulesRoutes);
router.use("/entities", entitiesRoutes);
router.use("/glossary", glossaryRoutes);
router.use("/kb", kbRoutes);
router.use("/onboarding", onboardingRoutes);
router.use("/ask", askRoutes);
router.use("/dashboards", dashboardRoutes);
router.use("/widgets", widgetRoutes);

export default router;
