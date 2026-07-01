import { PrismaClient } from "@prisma/client";
import { prisma } from "./prisma.js";

function buildTenantDatabaseUrl(baseUrl, dbName) {
  const parsed = new URL(baseUrl);
  parsed.pathname = `/${encodeURIComponent(dbName)}`;
  return parsed.toString();
}

function resolveBaseUrl() {
  return process.env.TENANT_DB_BASE_URL || process.env.DATABASE_URL;
}

/**
 * Tenant databases only receive `prisma migrate deploy` — they do not run `prisma db seed`.
 * Domain writes need `db_engine` rows and a `tenants` row for FKs. This mirrors those from
 * the central registry DB into the tenant DB (idempotent).
 */
export async function ensureTenantDbBootstrap(tenant) {
  if (!tenant?.tenantDbName || tenant.provisioningStatus !== "ready") {
    return;
  }

  const baseUrl = resolveBaseUrl();
  if (!baseUrl) {
    return;
  }

  const tenantUrl = buildTenantDatabaseUrl(baseUrl, tenant.tenantDbName);
  const tenantDb = new PrismaClient({
    datasourceUrl: tenantUrl,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  try {
    const [engineCount, tenantRow] = await Promise.all([
      tenantDb.dbEngine.count(),
      tenantDb.tenant.findUnique({
        where: { id: tenant.id },
        select: { id: true },
      }),
    ]);

    if (engineCount > 0 && tenantRow) {
      return;
    }

    const engines = await prisma.dbEngine.findMany();
    for (const e of engines) {
      await tenantDb.dbEngine.upsert({
        where: { code: e.code },
        create: {
          code: e.code,
          displayName: e.displayName,
          queryType: e.queryType,
          connectionParamSchema: e.connectionParamSchema,
        },
        update: {
          displayName: e.displayName,
          queryType: e.queryType,
          connectionParamSchema: e.connectionParamSchema,
        },
      });
    }

    await tenantDb.tenant.upsert({
      where: { id: tenant.id },
      create: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        status: tenant.status,
        provisioningStatus: tenant.provisioningStatus,
        tenantDbName: tenant.tenantDbName,
        tenantDbHost: tenant.tenantDbHost,
        tenantDbPort: tenant.tenantDbPort,
        provisionedAt: tenant.provisionedAt,
        provisioningError: tenant.provisioningError,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
      },
      update: {
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        status: tenant.status,
        provisioningStatus: tenant.provisioningStatus,
        tenantDbName: tenant.tenantDbName,
        tenantDbHost: tenant.tenantDbHost,
        tenantDbPort: tenant.tenantDbPort,
        provisionedAt: tenant.provisionedAt,
        provisioningError: tenant.provisioningError,
        updatedAt: tenant.updatedAt,
      },
    });
  } finally {
    await tenantDb.$disconnect();
  }
}
