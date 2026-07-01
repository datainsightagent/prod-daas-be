import { logger } from "../lib/logger.js";
import {
  getServiceKeyEntries,
  matchesAnyServiceKey,
} from "../lib/serviceApiKey.js";
import { errorResponse } from "../utils/apiEnvelope.js";

function readServiceKey(req) {
  return String(req.get("x-api-key") ?? "").trim();
}

function readTenantId(req) {
  return String(req.get("x-tenant-id") ?? req.get("X-Tenant-Id") ?? "").trim();
}

/**
 * Service-to-service auth for daas-ai → daas-backend (query probe/run).
 * Requires x-api-key + x-tenant-id. Uses AI_SERVICE_API_KEY (or AI_SERVICE_API_KEYS_JSON).
 */
export function requireServiceAuth(req, res, next) {
  const configuredEntries = getServiceKeyEntries();
  if (configuredEntries.length === 0) {
    logger.error({ event: "service_auth.misconfigured" });
    return res
      .status(500)
      .json(
        errorResponse(
          "internal_error",
          "Service authentication is not configured",
        ),
      );
  }

  const providedKey = readServiceKey(req);
  if (!providedKey || !matchesAnyServiceKey(providedKey, configuredEntries)) {
    logger.warn({
      event: "service_auth_failure",
      reason: "invalid_key",
      path: req.path,
    });
    return res
      .status(401)
      .json(errorResponse("auth_required", "Invalid service credentials"));
  }

  const tenantId = readTenantId(req);
  if (!tenantId) {
    logger.warn({
      event: "service_auth_failure",
      reason: "missing_tenant",
      path: req.path,
    });
    return res
      .status(400)
      .json(
        errorResponse("validation_error", "x-tenant-id header is required"),
      );
  }

  req.serviceAuth = { tenantId };
  return next();
}
