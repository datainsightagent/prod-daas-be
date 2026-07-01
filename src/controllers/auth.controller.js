import { errorResponse, successResponse } from "../utils/apiEnvelope.js";
import { z } from "zod";
import {
  AuthServiceError,
  getCurrentTenantFromAuth,
  getCurrentUserFromAuth,
  loginWithTenantScope,
  logoutWithRefreshToken,
  refreshAccessToken,
  registerTenantOwner,
} from "../services/auth.service.js";

const registerSchema = z.object({
  tenant_name: z.string().trim().min(1),
  tenant_slug: z.string().trim().min(1),
  name: z.string().trim().min(1),
  email: z.string().email(),
  password: z.string().min(12),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenant_slug: z.string().trim().min(1),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});

function handleAuthError(res, error, operationName) {
  if (error instanceof AuthServiceError) {
    return res
      .status(error.statusCode)
      .json(errorResponse(error.errorCode, error.message));
  }

  console.error(`${operationName} failed:`, error);
  return res
    .status(500)
    .json(
      errorResponse(
        "internal_error",
        `Unexpected error occurred while processing ${operationName}`,
      ),
    );
}

export async function register(req, res) {
  const parsed = registerSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json(errorResponse("validation_error", "Invalid register payload"));
  }

  const {
    tenant_name: tenantName,
    tenant_slug: tenantSlug,
    name,
    email,
    password,
  } = parsed.data;

  try {
    const payload = await registerTenantOwner({
      tenantName,
      tenantSlug,
      name,
      email,
      password,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });

    return res.status(201).json(successResponse(payload));
  } catch (error) {
    return handleAuthError(res, error, "register");
  }
}

export async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json(errorResponse("validation_error", "Invalid login payload"));
  }
  const { email, password, tenant_slug: tenantSlug } = parsed.data;

  try {
    const payload = await loginWithTenantScope({
      email,
      password,
      tenantSlug,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });

    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleAuthError(res, error, "login");
  }
}

export async function refresh(req, res) {
  const parsed = refreshSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json(errorResponse("validation_error", "Invalid refresh payload"));
  }
  const { refresh_token: refreshToken } = parsed.data;

  try {
    const payload = await refreshAccessToken({
      refreshToken,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });

    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleAuthError(res, error, "refresh");
  }
}

export async function logout(req, res) {
  const parsed = refreshSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json(errorResponse("validation_error", "Invalid logout payload"));
  }
  const { refresh_token: refreshToken } = parsed.data;

  try {
    await logoutWithRefreshToken({
      refreshToken,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });
    return res.status(200).json(successResponse({ logged_out: true }));
  } catch (error) {
    return handleAuthError(res, error, "logout");
  }
}

export async function usersMe(req, res) {
  try {
    const payload = getCurrentUserFromAuth(req.auth);
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleAuthError(res, error, "users_me");
  }
}

export async function tenantsMe(req, res) {
  try {
    const payload = getCurrentTenantFromAuth(req.auth);
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleAuthError(res, error, "tenants_me");
  }
}
