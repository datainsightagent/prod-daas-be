import express from "express";
import {
  getAskSessionTokenUsageSummaryHandler,
  getAskSessionHandler,
  listAskSessionsHandler,
  relayAskStreamHandler,
  resumeAskHandler,
  saveAskTurnHandler,
  startAskHandler,
  submitMessageFeedbackHandler,
} from "../controllers/ask.controller.js";

const router = express.Router();

router.post("/", startAskHandler);
router.post("/resume", resumeAskHandler);
router.get("/sessions", listAskSessionsHandler);
router.get("/sessions/:session_id", getAskSessionHandler);
router.get("/sessions/:session_id/stream", relayAskStreamHandler);
router.get(
  "/sessions/:session_id/token-usage-summary",
  getAskSessionTokenUsageSummaryHandler,
);
router.post("/sessions/:session_id/turns", saveAskTurnHandler);
router.post(
  "/sessions/:session_id/messages/:message_id/feedback",
  submitMessageFeedbackHandler,
);

export default router;
