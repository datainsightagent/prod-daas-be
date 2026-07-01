/**
 * Apply Prisma migrations to a tenant database (daas_tenant_*).
 *
 * Usage:
 *   node scripts/migrate-tenant-db.mjs <tenant-slug>
 *   node scripts/migrate-tenant-db.mjs di
 *   node scripts/migrate-tenant-db.mjs daas_tenant_di
 *
 * Requires TENANT_DB_BASE_URL (or DATABASE_URL) and TENANT_DB_ADMIN_URL in .env.
 */
import "dotenv/config";
import {
  initializeTenantDatabaseSchema,
  provisionTenantDatabase,
} from "../src/lib/tenantDbProvisioner.js";

function usage() {
  console.error("Usage: node scripts/migrate-tenant-db.mjs <tenant-slug>");
  console.error("Example: node scripts/migrate-tenant-db.mjs di");
  process.exit(1);
}

const rawArg = process.argv[2]?.trim();
if (!rawArg) {
  usage();
}

const prefix = process.env.TENANT_DB_NAME_PREFIX || "daas_tenant_";
const tenantSlug = rawArg.startsWith(prefix)
  ? rawArg.slice(prefix.length)
  : rawArg;

async function main() {
  const { dbName } = await provisionTenantDatabase({ tenantSlug });
  await initializeTenantDatabaseSchema({ dbName });
  console.log(`Migrations applied to tenant database: ${dbName}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
