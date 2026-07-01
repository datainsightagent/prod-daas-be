import { logger } from "../lib/logger.js";
import { errorResponse } from "../utils/apiEnvelope.js";
import { requireAuth } from "./requireAuth.js";
import {
  getServiceKeyEntries,
  resolveServiceKeyId,
} from "../lib/serviceApiKey.js";

function parseScopes(raw) {
  return String(raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveServiceScopeAllowlist() {
  const configured = parseScopes(process.env.AI_SERVICE_ALLOWED_SCOPES);
  if (configured.length > 0) {
    return new Set(configured);
  }
  return new Set(["datasource:read", "snapshot:read"]);
}

function buildServiceAuthContext({ tenantId, serviceKeyId }) {
  return {
    actorType: "service",
    authType: "api_key",
    serviceKeyId,
    userId: null,
    tenantId,
    role: "service",
    user: null,
    tenant: {
      id: tenantId,
      name: null,
      slug: null,
      status: null,
    },
  };
}

function logServiceAuthFailure(req, reason, details = {}) {
  logger.warn({
    event: "service_auth.failure",
    reason,
    method: req.method,
    path: req.path,
    ip: req.ip,
    ...details,
  });
}

export function requireUserOrServiceAuth({ scope }) {
  const requiredScope = String(scope || "").trim();
  if (!requiredScope) {
    throw new Error("requireUserOrServiceAuth requires a non-empty scope");
  }

  return async (req, res, next) => {
    const authHeader = req.get("authorization") ?? req.get("Authorization");
    const hasBearer = Boolean(
      authHeader && /^Bearer\s+.+$/i.test(String(authHeader)),
    );

    if (hasBearer) {
      return requireAuth(req, res, next);
    }

    const apiKey = String(req.get("x-api-key") || "").trim();
    if (!apiKey) {
      logServiceAuthFailure(req, "missing_credentials");
      return res
        .status(401)
        .json(errorResponse("auth_required", "Authentication required"));
    }

    const configuredEntries = getServiceKeyEntries();
    if (configuredEntries.length === 0) {
      logServiceAuthFailure(req, "service_key_not_configured");
      return res
        .status(503)
        .json(errorResponse("server_misconfigured", "Service auth is not configured"));
    }

    const serviceKeyId = resolveServiceKeyId(apiKey, configuredEntries);
    if (!serviceKeyId) {
      logServiceAuthFailure(req, "invalid_api_key");
      return res
        .status(401)
        .json(errorResponse("auth_required", "Invalid API key"));
    }

    const tenantId = String(req.get("x-tenant-id") || "").trim();
    if (!tenantId) {
      logServiceAuthFailure(req, "missing_tenant_id", { serviceKeyId });
      return res
        .status(400)
        .json(errorResponse("validation_error", "x-tenant-id header is required"));
    }

    const allowedScopes = resolveServiceScopeAllowlist();
    if (!allowedScopes.has(requiredScope)) {
      logServiceAuthFailure(req, "scope_not_allowed", {
        serviceKeyId,
        tenantId,
        scope: requiredScope,
      });
      return res
        .status(403)
        .json(errorResponse("forbidden", "Service key does not allow this scope"));
    }

    req.auth = buildServiceAuthContext({ tenantId, serviceKeyId });
    req.serviceAuth = {
      keyId: serviceKeyId,
      scope: requiredScope,
    };

    logger.info({
      event: "service_auth.success",
      serviceKeyId,
      tenantId,
      scope: requiredScope,
      method: req.method,
      path: req.path,
      ip: req.ip,
    });

    return next();
  };
}
