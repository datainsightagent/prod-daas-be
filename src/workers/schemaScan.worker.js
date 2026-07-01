import { prisma } from "../lib/prisma.js";
import { disconnectTenantPrismaClients } from "../lib/tenantPrismaClient.js";
import { logger } from "../lib/logger.js";
import {
  claimNextSchemaScanJob,
  executeSchemaScanForSnapshot,
  isRetryableSchemaScanError,
  scheduleSchemaSnapshotRetry,
} from "../services/dataSource.service.js";

const POLL_INTERVAL_MS = Number(process.env.SCHEMA_SCAN_POLL_INTERVAL_MS || 3000);
const IDLE_SLEEP_MS = Number(process.env.SCHEMA_SCAN_IDLE_SLEEP_MS || 1500);
const RETRY_DELAY_MS = Number(process.env.SCHEMA_SCAN_RETRY_DELAY_MS || 15000);
const MAX_JOBS_PER_TICK = Number(process.env.SCHEMA_SCAN_MAX_JOBS_PER_TICK || 2);

let shuttingDown = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processOneJob() {
  const claimed = await claimNextSchemaScanJob();
  if (!claimed) {
    return false;
  }

  logger.info({
    event: "schema.scan.worker.claimed",
    snapshotId: claimed.snapshotId,
    tenantId: claimed.tenantId,
    dataSourceId: claimed.dataSourceId,
    attemptCount: claimed.attemptCount,
  });

  try {
    await executeSchemaScanForSnapshot({
      tenantId: claimed.tenantId,
      snapshotId: claimed.snapshotId,
      statusAlreadyRunning: true,
    });
    return true;
  } catch (error) {
    const retryable = isRetryableSchemaScanError(error);
    if (retryable) {
      const scheduled = await scheduleSchemaSnapshotRetry({
        tenantId: claimed.tenantId,
        snapshotId: claimed.snapshotId,
        errorCode: error.errorCode,
        errorMessage: error.message,
        delayMs: RETRY_DELAY_MS,
      });

      if (scheduled) {
        logger.warn({
          event: "schema.scan.worker.retry_scheduled",
          snapshotId: claimed.snapshotId,
          tenantId: claimed.tenantId,
          dataSourceId: claimed.dataSourceId,
          retryDelayMs: RETRY_DELAY_MS,
        });
      }
    }
    return true;
  }
}

async function runWorkerLoop() {
  logger.info({
    event: "schema.scan.worker.started",
    pollIntervalMs: POLL_INTERVAL_MS,
    idleSleepMs: IDLE_SLEEP_MS,
    maxJobsPerTick: MAX_JOBS_PER_TICK,
  });

  while (!shuttingDown) {
    let processedAny = false;
    for (let i = 0; i < MAX_JOBS_PER_TICK; i += 1) {
      const processed = await processOneJob();
      if (!processed) {
        break;
      }
      processedAny = true;
    }

    if (!processedAny) {
      await sleep(IDLE_SLEEP_MS);
      continue;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ event: "schema.scan.worker.stopping", signal });
  try {
    await disconnectTenantPrismaClients();
    await prisma.$disconnect();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

runWorkerLoop().catch(async (error) => {
  logger.error({ event: "schema.scan.worker.crashed", err: error });
  await disconnectTenantPrismaClients();
  await prisma.$disconnect();
  process.exit(1);
});
