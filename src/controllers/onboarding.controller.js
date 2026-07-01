import { errorResponse, successResponse } from "../utils/apiEnvelope.js";
import {
  parseAdvanceOnboardingSessionInput,
  parseCreateOnboardingSessionInput,
  parseUpdateEntityDescriptionInput,
  parseUpdateOnboardingAnswerInput,
} from "../contracts/onboarding.contract.js";
import {
  advanceOnboardingSession,
  completeOnboardingSession,
  createOnboardingSession,
  getEntityDescriptionsByDataSource,
  getOnboardingAnswersByDataSource,
  getOnboardingSession,
  getOnboardingSessionTokenUsageSummary,
  OnboardingServiceError,
  relayOnboardingStream,
  saveOnboardingTokenUsage,
  updateEntityDescription,
  updateOnboardingAnswer,
} from "../services/onboarding.service.js";

function handleOnboardingError(res, error, operationName) {
  if (error instanceof OnboardingServiceError) {
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

export async function createOnboardingSessionHandler(req, res) {
  const parsed = parseCreateOnboardingSessionInput(req.body);
  if (!parsed) {
    return res
      .status(400)
      .json(errorResponse("validation_error", "Invalid onboarding session payload"));
  }

  try {
    const payload = await createOnboardingSession({
      auth: req.auth,
      input: parsed,
    });
    return res.status(201).json(successResponse(payload));
  } catch (error) {
    return handleOnboardingError(res, error, "onboarding_session_create");
  }
}

export async function getOnboardingSessionHandler(req, res) {
  try {
    const payload = await getOnboardingSession({
      auth: req.auth,
      sessionId: req.params.id,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleOnboardingError(res, error, "onboarding_session_get");
  }
}

export async function completeOnboardingSessionHandler(req, res) {
  try {
    const payload = await completeOnboardingSession({
      auth: req.auth,
      sessionId: req.params.id,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleOnboardingError(res, error, "onboarding_session_complete");
  }
}

export async function getOnboardingAnswersByDataSourceHandler(req, res) {
  try {
    const payload = await getOnboardingAnswersByDataSource({
      auth: req.auth,
      dataSourceId: req.params.dataSourceId,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleOnboardingError(res, error, "onboarding_answers_list");
  }
}

export async function getEntityDescriptionsByDataSourceHandler(req, res) {
  try {
    const payload = await getEntityDescriptionsByDataSource({
      auth: req.auth,
      dataSourceId: req.params.dataSourceId,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleOnboardingError(res, error, "entity_descriptions_list");
  }
}

export async function updateOnboardingAnswerHandler(req, res) {
  const parsed = parseUpdateOnboardingAnswerInput(req.body);
  if (!parsed) {
    return res
      .status(400)
      .json(errorResponse("validation_error", "Invalid answer update payload"));
  }

  try {
    const payload = await updateOnboardingAnswer({
      auth: req.auth,
      answerId: req.params.answerId,
      input: parsed,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleOnboardingError(res, error, "onboarding_answer_update");
  }
}

export async function updateEntityDescriptionHandler(req, res) {
  const parsed = parseUpdateEntityDescriptionInput(req.body);
  if (!parsed) {
    return res
      .status(400)
      .json(errorResponse("validation_error", "Invalid entity description update payload"));
  }

  try {
    const payload = await updateEntityDescription({
      auth: req.auth,
      entityId: req.params.entityId,
      input: parsed,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleOnboardingError(res, error, "entity_description_update");
  }
}

export async function relayOnboardingStreamHandler(req, res) {
  try {
    await relayOnboardingStream({
      auth: req.auth,
      sessionId: req.params.id,
      res,
    });
  } catch (error) {
    if (!res.headersSent) {
      return handleOnboardingError(res, error, "onboarding_stream_relay");
    }
    if (!res.writableEnded) {
      res.end();
    }
  }
}

export async function saveOnboardingTokenUsageHandler(req, res) {
  try {
    const payload = await saveOnboardingTokenUsage({
      auth: req.auth,
      sessionId: req.params.id,
      body: req.body,
    });
    return res.status(201).json(successResponse(payload));
  } catch (error) {
    return handleOnboardingError(res, error, "onboarding_token_usage_save");
  }
}

export async function getOnboardingSessionTokenUsageSummaryHandler(req, res) {
  try {
    const payload = await getOnboardingSessionTokenUsageSummary({
      auth: req.auth,
      sessionId: req.params.id,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleOnboardingError(res, error, "onboarding_token_usage_summary");
  }
}

export async function advanceOnboardingSessionHandler(req, res) {
  const parsed = parseAdvanceOnboardingSessionInput(req.body);
  if (!parsed) {
    return res
      .status(400)
      .json(errorResponse("validation_error", "Invalid onboarding advance payload"));
  }

  try {
    const payload = await advanceOnboardingSession({
      auth: req.auth,
      sessionId: req.params.id,
      input: parsed,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleOnboardingError(res, error, "onboarding_session_advance");
  }
}
