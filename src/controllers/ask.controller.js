import { errorResponse, successResponse } from "../utils/apiEnvelope.js";
import {
  AskServiceError,
  getAskSession,
  getAskSessionTokenUsageSummary,
  listAskSessions,
  relayAskStream,
  resumeAsk,
  saveAskTurn,
  startAsk,
  submitMessageFeedback,
} from "../services/ask.service.js";

function handleAskError(res, error, operationName) {
  if (error instanceof AskServiceError) {
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

export async function startAskHandler(req, res) {
  try {
    const payload = await startAsk({
      auth: req.auth,
      body: req.body,
    });
    return res.status(201).json(successResponse(payload));
  } catch (error) {
    return handleAskError(res, error, "ask_start");
  }
}

export async function resumeAskHandler(req, res) {
  try {
    const payload = await resumeAsk({
      auth: req.auth,
      body: req.body,
    });
    return res.status(201).json(successResponse(payload));
  } catch (error) {
    return handleAskError(res, error, "ask_resume");
  }
}

export async function listAskSessionsHandler(req, res) {
  try {
    const payload = await listAskSessions({ auth: req.auth });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleAskError(res, error, "ask_sessions_list");
  }
}

export async function getAskSessionHandler(req, res) {
  try {
    const payload = await getAskSession({
      auth: req.auth,
      sessionId: req.params.session_id,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleAskError(res, error, "ask_session_get");
  }
}

export async function saveAskTurnHandler(req, res) {
  try {
    const payload = await saveAskTurn({
      auth: req.auth,
      sessionId: req.params.session_id,
      body: req.body,
    });
    return res.status(201).json(successResponse(payload));
  } catch (error) {
    return handleAskError(res, error, "ask_turn_save");
  }
}

export async function relayAskStreamHandler(req, res) {
  try {
    await relayAskStream({
      auth: req.auth,
      sessionId: req.params.session_id,
      streamUrl: req.query.stream_url,
      streamToken: req.query.stream_token,
      res,
    });
  } catch (error) {
    if (!res.headersSent) {
      return handleAskError(res, error, "ask_stream_relay");
    }
    if (!res.writableEnded) {
      res.end();
    }
  }
}

export async function submitMessageFeedbackHandler(req, res) {
  try {
    const payload = await submitMessageFeedback({
      auth: req.auth,
      sessionId: req.params.session_id,
      messageId: req.params.message_id,
      body: req.body,
    });
    return res.status(201).json(successResponse(payload));
  } catch (error) {
    return handleAskError(res, error, "ask_message_feedback_submit");
  }
}

export async function getAskSessionTokenUsageSummaryHandler(req, res) {
  try {
    const payload = await getAskSessionTokenUsageSummary({
      auth: req.auth,
      sessionId: req.params.session_id,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleAskError(res, error, "ask_session_token_usage_summary");
  }
}
