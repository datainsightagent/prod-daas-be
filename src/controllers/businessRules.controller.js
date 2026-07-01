import { errorResponse, successResponse } from "../utils/apiEnvelope.js";
import {
  BusinessRulesServiceError,
  createBusinessRule,
  deleteBusinessRule,
  getBusinessRuleById,
  listBusinessRules,
  updateBusinessRule,
} from "../services/businessRules.service.js";

function handleBusinessRulesError(res, error, operationName) {
  if (error instanceof BusinessRulesServiceError) {
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

export async function createBusinessRuleHandler(req, res) {
  try {
    const payload = await createBusinessRule({
      auth: req.auth,
      input: req.body,
    });
    return res.status(201).json(successResponse(payload));
  } catch (error) {
    return handleBusinessRulesError(res, error, "business_rules_create");
  }
}

export async function listBusinessRulesHandler(req, res) {
  try {
    const payload = await listBusinessRules({ auth: req.auth });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleBusinessRulesError(res, error, "business_rules_list");
  }
}

export async function getBusinessRuleByIdHandler(req, res) {
  try {
    const payload = await getBusinessRuleById({
      auth: req.auth,
      ruleId: req.params.id,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleBusinessRulesError(res, error, "business_rules_get");
  }
}

export async function updateBusinessRuleHandler(req, res) {
  try {
    const payload = await updateBusinessRule({
      auth: req.auth,
      ruleId: req.params.id,
      input: req.body,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleBusinessRulesError(res, error, "business_rules_update");
  }
}

export async function deleteBusinessRuleHandler(req, res) {
  try {
    const payload = await deleteBusinessRule({
      auth: req.auth,
      ruleId: req.params.id,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleBusinessRulesError(res, error, "business_rules_delete");
  }
}
