import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import {
  deprovisionTenantDatabase,
  initializeTenantDatabaseSchema,
  provisionTenantDatabase,
} from "../lib/tenantDbProvisioner.js";

const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || "60m";
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || "14d";
const LOGIN_LOCKOUT_MAX_ATTEMPTS = Number(
  process.env.LOGIN_LOCKOUT_MAX_ATTEMPTS || 5,
);
const LOGIN_LOCKOUT_WINDOW_MINUTES = Number(
  process.env.LOGIN_LOCKOUT_WINDOW_MINUTES || 15,
);

class AuthServiceError extends Error {
  constructor(message, statusCode, errorCode) {
    super(message);
    this.name = "AuthServiceError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

function getJwtSecret() {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new AuthServiceError(
      "JWT access secret is not configured",
      500,
      "server_misconfigured",
    );
  }
  return secret;
}

function getRefreshJwtSecret() {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) {
    throw new AuthServiceError(
      "JWT refresh secret is not configured",
      500,
      "server_misconfigured",
    );
  }
  return secret;
}

function issueAccessToken({ userId, tenantId, role }) {
  return jwt.sign(
    {
      user_id: userId,
      tenant_id: tenantId,
      role,
    },
    getJwtSecret(),
    {
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    },
  );
}

function issueRefreshToken({ userId, tenantId, role }) {
  const jti = randomUUID();
  const token = jwt.sign(
    {
      user_id: userId,
      tenant_id: tenantId,
      role,
      type: "refresh",
      jti,
    },
    getRefreshJwtSecret(),
    {
      expiresIn: REFRESH_TOKEN_EXPIRES_IN,
    },
  );

  const decoded = jwt.decode(token);
  const expiresAt =
    decoded && typeof decoded === "object" && decoded.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  return {
    token,
    jti,
    expiresAt,
  };
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(value) {
  return String(value).trim().toLowerCase();
}

function normalizeTenantSlug(value) {
  return String(value).trim().toLowerCase();
}

function getLockoutWindowStart() {
  return new Date(Date.now() - LOGIN_LOCKOUT_WINDOW_MINUTES * 60 * 1000);
}

async function createAuditLog({
  event,
  userId,
  tenantId,
  ip,
  userAgent,
  metadata,
}) {
  await prisma.auditLog.create({
    data: {
      event,
      userId,
      tenantId,
      ip,
      userAgent,
      metadata,
    },
  });
}

async function countRecentLoginFailures({ email, tenantSlug }) {
  return prisma.loginFailureAttempt.count({
    where: {
      email,
      tenantSlug,
      createdAt: {
        gte: getLockoutWindowStart(),
      },
    },
  });
}

async function addLoginFailure({ email, tenantSlug }) {
  await prisma.loginFailureAttempt.create({
    data: {
      email,
      tenantSlug,
    },
  });
}

async function createFailedLoginAudit({
  tenantSlug,
  email,
  ip,
  userAgent,
  reason,
}) {
  await createAuditLog({
    event: "auth_login",
    userId: null,
    tenantId: null,
    ip,
    userAgent,
    metadata: {
      outcome: "failure",
      reason,
      tenant_slug: tenantSlug,
      email,
    },
  });
}

async function createInvalidLogoutAudit({ ip, userAgent }) {
  await createAuditLog({
    event: "auth_logout",
    userId: null,
    tenantId: null,
    ip,
    userAgent,
    metadata: {
      outcome: "invalid_token",
    },
  });
}

async function clearLoginFailures({ email, tenantSlug }) {
  await prisma.loginFailureAttempt.deleteMany({
    where: {
      email,
      tenantSlug,
    },
  });
}

async function persistRefreshToken({
  userId,
  tenantId,
  refreshToken,
  jti,
  expiresAt,
  ip,
  userAgent,
}) {
  await prisma.refreshToken.create({
    data: {
      jti,
      userId,
      tenantId,
      tokenHash: hashToken(refreshToken),
      expiresAt,
      ip,
      userAgent,
    },
  });
}

async function resolveActiveUserRole({ userId, tenantId }) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      tenantId,
      status: "active",
      tenant: {
        status: "active",
      },
    },
    include: {
      memberships: {
        where: {
          tenantId,
          status: "active",
        },
        include: {
          role: true,
        },
        take: 1,
      },
    },
  });

  if (!user) {
    throw new AuthServiceError(
      "Invalid credentials",
      401,
      "invalid_credentials",
    );
  }

  const membership = user.memberships[0];
  const role = membership?.role?.name;
  if (!role) {
    throw new AuthServiceError(
      "Active membership not found",
      403,
      "membership_missing",
    );
  }

  return { user, role };
}

async function issueAndStoreTokens({ userId, tenantId, role, ip, userAgent }) {
  const accessToken = issueAccessToken({ userId, tenantId, role });
  const issuedRefresh = issueRefreshToken({ userId, tenantId, role });

  await persistRefreshToken({
    userId,
    tenantId,
    refreshToken: issuedRefresh.token,
    jti: issuedRefresh.jti,
    expiresAt: issuedRefresh.expiresAt,
    ip,
    userAgent,
  });

  return {
    accessToken,
    refreshToken: issuedRefresh.token,
  };
}

export async function registerTenantOwner({
  tenantName,
  tenantSlug,
  name,
  email,
  password,
  ip,
  userAgent,
}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedTenantSlug = normalizeTenantSlug(tenantSlug);
  let tenantDbInfo = null;
  /** Set true only after central tenant/user/membership transaction commits; avoids dropping tenant MySQL when a later step (e.g. refresh token) fails. */
  let centralRegistryCommitted = false;

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    tenantDbInfo = await provisionTenantDatabase({ tenantSlug: normalizedTenantSlug });
    await initializeTenantDatabaseSchema({ dbName: tenantDbInfo.dbName });

    const created = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: String(tenantName).trim(),
          slug: normalizedTenantSlug,
          provisioningStatus: "ready",
          tenantDbName: tenantDbInfo.dbName,
          tenantDbHost: tenantDbInfo.host,
          tenantDbPort: tenantDbInfo.port,
          provisionedAt: new Date(),
        },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: normalizedEmail,
          passwordHash,
          name: String(name).trim(),
        },
      });

      const tenantAdminRole = await tx.role.findUnique({
        where: { name: "tenant_admin" },
      });

      if (!tenantAdminRole) {
        throw new AuthServiceError(
          "Role tenant_admin is not seeded.",
          500,
          "seed_missing",
        );
      }

      await tx.membership.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          roleId: tenantAdminRole.id,
        },
      });

      return { tenant, user, role: tenantAdminRole.name };
    });

    centralRegistryCommitted = true;

    const tokens = await issueAndStoreTokens({
      userId: created.user.id,
      tenantId: created.tenant.id,
      role: created.role,
      ip,
      userAgent,
    });

    return {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      user: {
        user_id: created.user.id,
        tenant_id: created.user.tenantId,
        name: created.user.name,
        role: created.role,
      },
      tenant: {
        tenant_id: created.tenant.id,
        name: created.tenant.name,
        slug: created.tenant.slug,
      },
    };
  } catch (error) {
    if (tenantDbInfo?.dbName && !centralRegistryCommitted) {
      await deprovisionTenantDatabase({ dbName: tenantDbInfo.dbName }).catch(() => {});
    }
    if (error?.code === "P2002") {
      throw new AuthServiceError(
        "Tenant slug or user already exists",
        409,
        "already_exists",
      );
    }
    throw error;
  }
}

export async function loginWithTenantScope({
  email,
  password,
  tenantSlug,
  ip,
  userAgent,
}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedTenantSlug = normalizeTenantSlug(tenantSlug);

  const failedAttempts = await countRecentLoginFailures({
    email: normalizedEmail,
    tenantSlug: normalizedTenantSlug,
  });
  if (failedAttempts >= LOGIN_LOCKOUT_MAX_ATTEMPTS) {
    await createFailedLoginAudit({
      tenantSlug: normalizedTenantSlug,
      email: normalizedEmail,
      ip,
      userAgent,
      reason: "rate_limited",
    });
    throw new AuthServiceError(
      "Too many failed login attempts. Try again later.",
      429,
      "rate_limited",
    );
  }

  const user = await prisma.user.findFirst({
    where: {
      email: normalizedEmail,
      status: "active",
      tenant: {
        slug: normalizedTenantSlug,
        status: "active",
      },
    },
    include: {
      memberships: {
        where: {
          status: "active",
        },
        include: {
          role: true,
        },
        take: 1,
      },
    },
  });

  if (!user) {
    await addLoginFailure({
      email: normalizedEmail,
      tenantSlug: normalizedTenantSlug,
    });
    const attemptsAfterFailure = await countRecentLoginFailures({
      email: normalizedEmail,
      tenantSlug: normalizedTenantSlug,
    });
    if (attemptsAfterFailure >= LOGIN_LOCKOUT_MAX_ATTEMPTS) {
      await createFailedLoginAudit({
        tenantSlug: normalizedTenantSlug,
        email: normalizedEmail,
        ip,
        userAgent,
        reason: "rate_limited",
      });
      throw new AuthServiceError(
        "Too many failed login attempts. Try again later.",
        429,
        "rate_limited",
      );
    }
    await createFailedLoginAudit({
      tenantSlug: normalizedTenantSlug,
      email: normalizedEmail,
      ip,
      userAgent,
      reason: "invalid_credentials",
    });
    throw new AuthServiceError("Invalid credentials", 401, "invalid_credentials");
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    await addLoginFailure({
      email: normalizedEmail,
      tenantSlug: normalizedTenantSlug,
    });
    const attemptsAfterFailure = await countRecentLoginFailures({
      email: normalizedEmail,
      tenantSlug: normalizedTenantSlug,
    });
    if (attemptsAfterFailure >= LOGIN_LOCKOUT_MAX_ATTEMPTS) {
      await createFailedLoginAudit({
        tenantSlug: normalizedTenantSlug,
        email: normalizedEmail,
        ip,
        userAgent,
        reason: "rate_limited",
      });
      throw new AuthServiceError(
        "Too many failed login attempts. Try again later.",
        429,
        "rate_limited",
      );
    }
    await createFailedLoginAudit({
      tenantSlug: normalizedTenantSlug,
      email: normalizedEmail,
      ip,
      userAgent,
      reason: "invalid_credentials",
    });
    throw new AuthServiceError("Invalid credentials", 401, "invalid_credentials");
  }

  const membership = user.memberships[0];
  const role = membership?.role?.name;
  if (!role) {
    throw new AuthServiceError(
      "Active membership not found",
      403,
      "membership_missing",
    );
  }

  const tokens = await issueAndStoreTokens({
    userId: user.id,
    tenantId: user.tenantId,
    role,
    ip,
    userAgent,
  });

  await clearLoginFailures({
    email: normalizedEmail,
    tenantSlug: normalizedTenantSlug,
  });

  await createAuditLog({
    event: "auth_login",
    userId: user.id,
    tenantId: user.tenantId,
    ip,
    userAgent,
    metadata: {
      method: "password",
    },
  });

  return {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    user: {
      user_id: user.id,
      tenant_id: user.tenantId,
      name: user.name,
      role,
    },
  };
}

export async function refreshAccessToken({ refreshToken, ip, userAgent }) {
  let payload;
  try {
    payload = jwt.verify(refreshToken, getRefreshJwtSecret());
  } catch (_error) {
    throw new AuthServiceError(
      "Refresh token is invalid",
      401,
      "auth_required",
    );
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    payload.type !== "refresh" ||
    !payload.jti ||
    !payload.user_id ||
    !payload.tenant_id
  ) {
    throw new AuthServiceError(
      "Refresh token is invalid",
      401,
      "auth_required",
    );
  }

  const tokenRecord = await prisma.refreshToken.findUnique({
    where: { jti: payload.jti },
  });

  if (!tokenRecord) {
    throw new AuthServiceError(
      "Refresh token is invalid",
      401,
      "auth_required",
    );
  }

  if (tokenRecord.revokedAt) {
    throw new AuthServiceError(
      "Refresh token reuse detected",
      401,
      "refresh_token_reuse",
    );
  }

  if (tokenRecord.expiresAt.getTime() <= Date.now()) {
    throw new AuthServiceError(
      "Refresh token is expired",
      401,
      "auth_required",
    );
  }

  if (tokenRecord.tokenHash !== hashToken(refreshToken)) {
    await prisma.refreshToken.update({
      where: { jti: payload.jti },
      data: { revokedAt: new Date() },
    });
    throw new AuthServiceError(
      "Refresh token reuse detected",
      401,
      "refresh_token_reuse",
    );
  }

  const { user, role } = await resolveActiveUserRole({
    userId: payload.user_id,
    tenantId: payload.tenant_id,
  });

  const newTokens = await prisma.$transaction(async (tx) => {
    const issuedRefresh = issueRefreshToken({
      userId: user.id,
      tenantId: user.tenantId,
      role,
    });

    await tx.refreshToken.update({
      where: { jti: payload.jti },
      data: {
        revokedAt: new Date(),
        replacedByToken: issuedRefresh.jti,
      },
    });

    await tx.refreshToken.create({
      data: {
        jti: issuedRefresh.jti,
        userId: user.id,
        tenantId: user.tenantId,
        tokenHash: hashToken(issuedRefresh.token),
        expiresAt: issuedRefresh.expiresAt,
        ip,
        userAgent,
      },
    });

    return {
      accessToken: issueAccessToken({
        userId: user.id,
        tenantId: user.tenantId,
        role,
      }),
      refreshToken: issuedRefresh.token,
    };
  });

  await createAuditLog({
    event: "auth_refresh",
    userId: user.id,
    tenantId: user.tenantId,
    ip,
    userAgent,
    metadata: {
      rotated_from_jti: payload.jti,
    },
  });

  return {
    access_token: newTokens.accessToken,
    refresh_token: newTokens.refreshToken,
    user: {
      user_id: user.id,
      tenant_id: user.tenantId,
      name: user.name,
      role,
    },
  };
}

export async function logoutWithRefreshToken({ refreshToken, ip, userAgent }) {
  let payload;
  try {
    payload = jwt.verify(refreshToken, getRefreshJwtSecret(), {
      ignoreExpiration: true,
    });
  } catch (_error) {
    await createInvalidLogoutAudit({ ip, userAgent });
    return;
  }

  if (!payload || typeof payload !== "object" || !payload.jti) {
    await createInvalidLogoutAudit({ ip, userAgent });
    return;
  }

  const updateResult = await prisma.refreshToken.updateMany({
    where: {
      jti: payload.jti,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  await createAuditLog({
    event: "auth_logout",
    userId: payload.user_id,
    tenantId: payload.tenant_id,
    ip,
    userAgent,
    metadata: {
      jti: payload.jti,
      revoked_count: updateResult.count,
      outcome: updateResult.count > 0 ? "revoked" : "no_active_session",
    },
  });
}

export function getCurrentUserFromAuth(auth) {
  return {
    user_id: auth.user.id,
    tenant_id: auth.tenantId,
    email: auth.user.email,
    name: auth.user.name,
    role: auth.role,
  };
}

export function getCurrentTenantFromAuth(auth) {
  return {
    tenant_id: auth.tenant.id,
    name: auth.tenant.name,
    slug: auth.tenant.slug,
    status: auth.tenant.status,
  };
}

export function assertRequiredRole(auth, allowedRoles) {
  if (!auth?.role || !allowedRoles.includes(auth.role)) {
    throw new AuthServiceError(
      "Insufficient role permissions",
      403,
      "forbidden",
    );
  }
}

export { AuthServiceError };
