import express from "express";
import {
  advanceOnboardingSessionHandler,
  completeOnboardingSessionHandler,
  createOnboardingSessionHandler,
  getEntityDescriptionsByDataSourceHandler,
  getOnboardingAnswersByDataSourceHandler,
  getOnboardingSessionHandler,
  getOnboardingSessionTokenUsageSummaryHandler,
  relayOnboardingStreamHandler,
  saveOnboardingTokenUsageHandler,
  updateEntityDescriptionHandler,
  updateOnboardingAnswerHandler,
} from "../controllers/onboarding.controller.js";

const router = express.Router();

router.post("/sessions", createOnboardingSessionHandler);
router.get("/sessions/:id", getOnboardingSessionHandler);
router.get("/sessions/:id/stream", relayOnboardingStreamHandler);
router.post("/sessions/:id/advance", advanceOnboardingSessionHandler);
router.post("/sessions/:id/complete", completeOnboardingSessionHandler);
router.post("/sessions/:id/token-usage", saveOnboardingTokenUsageHandler);
router.get(
  "/sessions/:id/token-usage-summary",
  getOnboardingSessionTokenUsageSummaryHandler,
);

router.get("/data-sources/:dataSourceId/answers", getOnboardingAnswersByDataSourceHandler);
router.get("/data-sources/:dataSourceId/entity-descriptions", getEntityDescriptionsByDataSourceHandler);

router.put("/answers/:answerId", updateOnboardingAnswerHandler);
router.put("/entity-descriptions/:entityId", updateEntityDescriptionHandler);

export default router;
