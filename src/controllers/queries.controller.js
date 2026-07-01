import { errorResponse, successResponse } from "../utils/apiEnvelope.js";
import {
  parseQueryRunBody,
  parseQueryValidateBody,
} from "../contracts/queries.contract.js";
import {
  QueryServiceError,
  runQuery,
  validateQuery,
} from "../services/queryExecution.service.js";

function handleQueryError(res, error, operationName) {
  if (error instanceof QueryServiceError) {
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

export async function validateQueryHandler(req, res) {
  try {
    const parsed = parseQueryValidateBody(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json(errorResponse("validation_error", "Invalid request body"));
    }

    const payload = await validateQuery({ sql: parsed.data.sql });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleQueryError(res, error, "query_validate");
  }
}

export async function runQueryHandler(req, res) {
  try {
    const parsed = parseQueryRunBody(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json(errorResponse("validation_error", "Invalid request body"));
    }

    const payload = await runQuery({
      tenantId: req.serviceAuth.tenantId,
      dataSourceId: parsed.data.data_source_id,
      sql: parsed.data.sql,
      timeoutSeconds: parsed.data.timeout_seconds,
      rowLimit: parsed.data.row_limit,
      purpose: parsed.data.purpose,
    });

    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleQueryError(res, error, "query_run");
  }
}
