import { PrismaClient } from "@prisma/client";
import { ensureTenantDbBootstrap } from "./tenantDbBootstrap.js";
import { prisma } from "./prisma.js";

const tenantClients = new Map();
const tenantClientInFlight = new Map();
const DEFAULT_TENANT_CLIENT_TTL_MS = 5 * 60 * 1000;
const parsedTenantClientTtlMs =
  process.env.TENANT_CLIENT_TTL_MS === undefined
    ? DEFAULT_TENANT_CLIENT_TTL_MS
    : Number(process.env.TENANT_CLIENT_TTL_MS);
const TENANT_CLIENT_TTL_MS =
  Number.isFinite(parsedTenantClientTtlMs) && parsedTenantClientTtlMs > 0
    ? parsedTenantClientTtlMs
    : DEFAULT_TENANT_CLIENT_TTL_MS;

function buildTenantDatabaseUrl(baseUrl, dbName) {
  const parsed = new URL(baseUrl);
  parsed.pathname = `/${encodeURIComponent(dbName)}`;
  return parsed.toString();
}

function resolveBaseUrl() {
  return process.env.TENANT_DB_BASE_URL || process.env.DATABASE_URL;
}

function getCachedClient(tenantId) {
  const cached = tenantClients.get(tenantId);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    cached.client.$disconnect().catch(() => {});
    tenantClients.delete(tenantId);
    return null;
  }
  return cached.client;
}

export async function getTenantPrismaClientByTenantId(tenantId) {
  const cached = getCachedClient(tenantId);
  if (cached) return cached;
  const inFlight = tenantClientInFlight.get(tenantId);
  if (inFlight) return inFlight;

  const createClientPromise = (async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        status: true,
        provisioningStatus: true,
        tenantDbName: true,
        tenantDbHost: true,
        tenantDbPort: true,
        provisionedAt: true,
        provisioningError: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!tenant || tenant.provisioningStatus !== "ready" || !tenant.tenantDbName) {
      throw new Error("Tenant database is not ready");
    }

    await ensureTenantDbBootstrap(tenant);

    const baseUrl = resolveBaseUrl();
    if (!baseUrl) {
      throw new Error("TENANT_DB_BASE_URL (or DATABASE_URL) is required");
    }

    const client = new PrismaClient({
      datasourceUrl: buildTenantDatabaseUrl(baseUrl, tenant.tenantDbName),
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });

    tenantClients.set(tenantId, {
      client,
      expiresAt: Date.now() + TENANT_CLIENT_TTL_MS,
    });

    return client;
  })();

  tenantClientInFlight.set(tenantId, createClientPromise);
  try {
    return await createClientPromise;
  } finally {
    tenantClientInFlight.delete(tenantId);
  }
}

/** Tenants that have a provisioned MySQL DB (excludes legacy rows with provisioningStatus ready but no tenantDbName). */
export async function listReadyTenantIds() {
  const rows = await prisma.tenant.findMany({
    where: {
      provisioningStatus: "ready",
      tenantDbName: { not: null },
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
    },
  });
  return rows.map((row) => row.id);
}

export async function disconnectTenantPrismaClients() {
  const clients = [...tenantClients.values()].map((entry) => entry.client);
  tenantClients.clear();
  tenantClientInFlight.clear();
  await Promise.allSettled(clients.map((client) => client.$disconnect()));
}
