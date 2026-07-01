import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { errorResponse } from "../utils/apiEnvelope.js";

function parseBearerToken(req) {
  const header = req.get("authorization") ?? req.get("Authorization");
  if (!header || typeof header !== "string") {
    return null;
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Build immutable auth context from database-backed user and resolved role.
 * This function is pure and can be unit tested without Express.
 */
export function buildAuthContext(user, dbRole) {
  return {
    userId: user.id,
    tenantId: user.tenantId,
    role: dbRole,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    tenant: {
      id: user.tenant.id,
      name: user.tenant.name,
      slug: user.tenant.slug,
      status: user.tenant.status,
    },
  };
}

function logAuthFailure(req, reason, payload) {
  logger.warn({
    event: "auth_failure",
    reason,
    userId: payload?.user_id,
    tenantId: payload?.tenant_id,
    path: req.path,
    ip: req.ip,
  });
}

/**
 * Verifies bearer access JWT and attaches `req.auth` for downstream handlers.
 *
 * `req.auth` includes:
 * - `userId`
 * - `tenantId`
 * - `role`
 * - `user`: `{ id, email, name }`
 * - `tenant`: `{ id, name, slug, status }`
 *
 * Apply this middleware to protected V1 routes and exclude `/v1/auth/*` and
 * `/health` style endpoints.
 */
export async function requireAuth(req, res, next) {
  const token = parseBearerToken(req);
  if (!token) {
    logAuthFailure(req, "auth_required");
    return res
      .status(401)
      .json(errorResponse("auth_required", "Authentication required"));
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET, {
      clockTolerance: 60,
    });
  } catch (_err) {
    logAuthFailure(req, "auth_required");
    return res
      .status(401)
      .json(errorResponse("auth_required", "Invalid or expired access token"));
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    payload.type === "refresh" ||
    !payload.user_id ||
    !payload.tenant_id ||
    !payload.role
  ) {
    logAuthFailure(req, "auth_required", payload);
    return res
      .status(401)
      .json(errorResponse("auth_required", "Invalid or expired access token"));
  }

  try {
    // PRD-01 Section 12: must query DB on every request — do not cache.

    const user = await prisma.user.findFirst({
      where: {
        id: payload.user_id,
        tenantId: payload.tenant_id,
        status: "active",
        memberships: {
          some: {
            tenantId: payload.tenant_id,
            status: "active",
          },
        },
      },
      include: {
        tenant: true,
        memberships: {
          where: {
            tenantId: payload.tenant_id,
            status: "active",
          },
          include: { role: true },
          take: 1,
        },
      },
    });

    if (!user) {
      logAuthFailure(req, "auth_required", payload);
      return res
        .status(401)
        .json(
          errorResponse("auth_required", "Invalid or expired access token"),
        );
    }

    if (user.tenant.status !== "active") {
      logAuthFailure(req, "tenant_suspended", payload);
      return res
        .status(403)
        .json(errorResponse("tenant_suspended", "Tenant is suspended"));
    }

    const dbRole = user.memberships[0]?.role?.name;
    if (!dbRole || dbRole !== payload.role) {
      logAuthFailure(req, "auth_required", payload);
      return res
        .status(401)
        .json(
          errorResponse("auth_required", "Invalid or expired access token"),
        );
    }

    req.auth = buildAuthContext(user, dbRole);

    return next();
  } catch (err) {
    logger.error({
      event: "auth_failure",
      reason: "internal_error",
      userId: payload?.user_id,
      tenantId: payload?.tenant_id,
      path: req.path,
      ip: req.ip,
      err,
    });
    return res
      .status(500)
      .json(errorResponse("internal_error", "Authentication check failed"));
  }
}

/**
 * Defense-in-depth tenant path guard per PRD-01 Section 15.
 * This is a no-op if the route does not include the named path param.
 * Attach this only to routes that include `:tenantId` in the URL path.
 * This is not primary tenant enforcement; token claims remain primary.
 */
export function requirePathTenantMatch(paramName = "tenantId") {
  return (req, res, next) => {
    const fromPath = req.params[paramName];
    if (fromPath === undefined || fromPath === null || fromPath === "") {
      return next();
    }
    if (!req.auth?.tenantId) {
      return res
        .status(401)
        .json(errorResponse("auth_required", "Authentication required"));
    }
    if (fromPath !== req.auth.tenantId) {
      return res
        .status(403)
        .json(
          errorResponse(
            "tenant_mismatch",
            "Path tenant does not match authenticated tenant",
          ),
        );
    }
    return next();
  };
}
