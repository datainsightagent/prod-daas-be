import mysql from "mysql2/promise";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, "``")}\``;
}

function normalizeTenantDbName(slug) {
  const prefix = process.env.TENANT_DB_NAME_PREFIX || "daas_tenant_";
  const normalizedSlug = String(slug).trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return `${prefix}${normalizedSlug}`;
}

function getRegistryHost() {
  return process.env.TENANT_DB_HOST || process.env.MYSQL_HOST || "127.0.0.1";
}

function getRegistryPort() {
  return Number(process.env.TENANT_DB_PORT || process.env.MYSQL_PORT || 3306);
}

function getAdminUrl() {
  const fromEnv = process.env.TENANT_DB_ADMIN_URL;
  if (fromEnv) return fromEnv;
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error(
      "TENANT_DB_ADMIN_URL (or DATABASE_URL) is required for tenant DB provisioning",
    );
  }
  return dbUrl;
}

function buildTenantDatabaseUrl(baseUrl, dbName) {
  const parsed = new URL(baseUrl);
  parsed.pathname = `/${encodeURIComponent(dbName)}`;
  return parsed.toString();
}

function getTenantBaseUrl() {
  const baseUrl = process.env.TENANT_DB_BASE_URL || process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error("TENANT_DB_BASE_URL (or DATABASE_URL) is required");
  }
  return baseUrl;
}

export async function initializeTenantDatabaseSchema({ dbName }) {
  const tenantDatabaseUrl = buildTenantDatabaseUrl(getTenantBaseUrl(), dbName);
  const prismaDeployCommand = "npx prisma migrate deploy --schema prisma/schema.prisma";

  try {
    await execAsync(prismaDeployCommand, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: tenantDatabaseUrl,
      },
    });
  } catch (error) {
    const stdout = error?.stdout || "";
    const stderr = error?.stderr || "";
    throw new Error(
      `Tenant schema initialization failed for '${dbName}'. ${stdout}\n${stderr}`.trim(),
    );
  }
}

export async function provisionTenantDatabase({ tenantSlug }) {
  const dbName = normalizeTenantDbName(tenantSlug);
  const connection = await mysql.createConnection(getAdminUrl());
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(dbName)}`);
  } finally {
    await connection.end();
  }

  return {
    dbName,
    host: getRegistryHost(),
    port: getRegistryPort(),
  };
}

export async function deprovisionTenantDatabase({ dbName }) {
  if (!dbName) return;
  const connection = await mysql.createConnection(getAdminUrl());
  try {
    await connection.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(dbName)}`);
  } finally {
    await connection.end();
  }
}
