import { errorResponse, successResponse } from "../utils/apiEnvelope.js";
import {
  createGlossaryTerm,
  deleteGlossaryTerm,
  getGlossaryTermById,
  GlossaryServiceError,
  listGlossaryTerms,
  updateGlossaryTerm,
} from "../services/glossary.service.js";

function handleGlossaryError(res, error, operationName) {
  if (error instanceof GlossaryServiceError) {
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

export async function createGlossaryTermHandler(req, res) {
  try {
    const payload = await createGlossaryTerm({
      auth: req.auth,
      input: req.body,
    });
    return res.status(201).json(successResponse(payload));
  } catch (error) {
    return handleGlossaryError(res, error, "glossary_create");
  }
}

export async function listGlossaryTermsHandler(req, res) {
  try {
    const payload = await listGlossaryTerms({ auth: req.auth });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleGlossaryError(res, error, "glossary_list");
  }
}

export async function getGlossaryTermByIdHandler(req, res) {
  try {
    const payload = await getGlossaryTermById({
      auth: req.auth,
      termId: req.params.id,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleGlossaryError(res, error, "glossary_get");
  }
}

export async function updateGlossaryTermHandler(req, res) {
  try {
    const payload = await updateGlossaryTerm({
      auth: req.auth,
      termId: req.params.id,
      input: req.body,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleGlossaryError(res, error, "glossary_update");
  }
}

export async function deleteGlossaryTermHandler(req, res) {
  try {
    const payload = await deleteGlossaryTerm({
      auth: req.auth,
      termId: req.params.id,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleGlossaryError(res, error, "glossary_delete");
  }
}
