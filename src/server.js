import express from "express";
import cors from "cors";
import { prisma, isDatabaseConfigured } from "./lib/prisma.js";
import { logger } from "./lib/logger.js";
import { validateDataSourceCryptoConfig } from "./lib/crypto/dataSourceCrypto.js";
import { requestContextMiddleware } from "./lib/requestContext.js";
import authRoutes from "./routes/auth.routes.js";
import v1Routes from "./routes/v1.routes.js";
import { errorResponse } from "./utils/apiEnvelope.js";

const app = express();
const PORT = process.env.PORT || 5000;

const requiredAuthEnv = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];
const missingAuthEnv = requiredAuthEnv.filter((key) => !process.env[key]);
if (missingAuthEnv.length > 0) {
  throw new Error(
    `Missing required auth environment variables: ${missingAuthEnv.join(", ")}`,
  );
}

try {
  validateDataSourceCryptoConfig();
} catch (error) {
  logger.warn({
    event: "datasource_crypto_not_configured",
    message: error instanceof Error ? error.message : "unknown_error",
  });
}

app.use(requestContextMiddleware);
app.use(cors());
app.use(express.json());
app.use("/v1/auth", authRoutes);
app.use("/v1", v1Routes);

app.get("/", (_req, res) => {
  res.json({ message: "Hello from DataInsight backend" });
});

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/api/db/ping", async (_req, res) => {
  if (!isDatabaseConfigured()) {
    return res.status(503).json({
      ok: false,
      message:
        "Database is not configured. Set DATABASE_URL or MYSQL_HOST, MYSQL_USER, and MYSQL_DATABASE in .env (see .env.example).",
    });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ ok: true, message: "MySQL connection OK (Prisma)" });
  } catch (err) {
    logger.error({ event: "db_ping_failed", err });
    return res.status(503).json({
      ok: false,
      message: err instanceof Error ? err.message : "MySQL connection failed",
    });
  }
});

app.use((_req, res) => {
  return res.status(404).json(errorResponse("not_found", "Route not found"));
});

app.listen(PORT, () => {
  logger.info({ event: "server_started", port: PORT });
});
