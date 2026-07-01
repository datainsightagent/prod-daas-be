import "dotenv/config";
import { PrismaClient } from "@prisma/client";

/**
 * Prisma reads DATABASE_URL. If you only set MYSQL_* in .env, build URL here.
 */
function ensureDatabaseUrl() {
  if (process.env.DATABASE_URL) return;

  const host = process.env.MYSQL_HOST;
  const user = process.env.MYSQL_USER;
  const database = process.env.MYSQL_DATABASE;
  if (!host || !user || !database) return;

  const port = process.env.MYSQL_PORT || "3306";
  const password = process.env.MYSQL_PASSWORD ?? "";
  process.env.DATABASE_URL = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

ensureDatabaseUrl();

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
