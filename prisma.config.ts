import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Prefer process.env so tenant migrations can target daas_tenant_* via:
 *   DATABASE_URL="mysql://.../daas_tenant_slug" npx prisma migrate deploy
 * or: npm run prisma:migrate:tenant -- <tenant-slug>
 *
 * env("DATABASE_URL") alone reads .env and ignores shell overrides when
 * prisma.config.ts is active.
 */
function resolveDatabaseUrl() {
  const fromProcess = process.env.DATABASE_URL?.trim();
  if (fromProcess) {
    return fromProcess;
  }
  return env("DATABASE_URL");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  engine: "classic",
  datasource: {
    url: resolveDatabaseUrl(),
  },
  migrations: {
    seed: "node prisma/seed.js",
  },
});
