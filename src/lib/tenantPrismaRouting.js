import { prisma } from "./prisma.js";
import { getTenantPrismaClientByTenantId } from "./tenantPrismaClient.js";

export function isTenantDbReadWriteEnabled() {
  return (
    String(process.env.TENANT_DB_READ_WRITE_ENABLED || "false")
      .trim()
      .toLowerCase() === "true"
  );
}

async function tenantHasRoutableDedicatedDb(tenantId) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      provisioningStatus: true,
      tenantDbName: true,
    },
  });
  return Boolean(
    tenant?.tenantDbName &&
      String(tenant.tenantDbName).trim() &&
      tenant.provisioningStatus === "ready",
  );
}

export async function resolveDomainPrismaForAuth(auth) {
  if (!isTenantDbReadWriteEnabled()) {
    return prisma;
  }
  if (!(await tenantHasRoutableDedicatedDb(auth.tenantId))) {
    return prisma;
  }
  return getTenantPrismaClientByTenantId(auth.tenantId);
}

export async function resolveDomainPrismaForTenantId(tenantId) {
  if (!isTenantDbReadWriteEnabled()) {
    return prisma;
  }
  if (!(await tenantHasRoutableDedicatedDb(tenantId))) {
    return prisma;
  }
  return getTenantPrismaClientByTenantId(tenantId);
}
