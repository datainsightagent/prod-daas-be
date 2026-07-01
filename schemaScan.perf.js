const BASE_URL = process.env.PERF_BASE_URL || "http://localhost:5000";
const ACCESS_TOKEN = process.env.PERF_ACCESS_TOKEN;
const DATA_SOURCE_ID = process.env.PERF_DATA_SOURCE_ID;
const RUNS = Number(process.env.PERF_RUNS || 10);
const SAMPLE_ROWS_PER_TABLE = Number(process.env.PERF_SAMPLE_ROWS_PER_TABLE || 3);
const INCLUDE_FOREIGN_KEYS =
  String(process.env.PERF_INCLUDE_FOREIGN_KEYS || "true").toLowerCase() !== "false";
const POLL_INTERVAL_MS = Number(process.env.PERF_POLL_INTERVAL_MS || 1000);
const TIMEOUT_MS = Number(process.env.PERF_TIMEOUT_MS || 120000);
const TARGET_P95_MS = Number(process.env.PERF_TARGET_P95_MS || 60000);

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      ...(options.headers || {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${options.method || "GET"} ${path} failed with ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function enqueueScan() {
  const body = await requestJson(`/v1/data-sources/${DATA_SOURCE_ID}/schema-scan`, {
    method: "POST",
    body: JSON.stringify({
      sample_rows_per_table: SAMPLE_ROWS_PER_TABLE,
      include_foreign_keys: INCLUDE_FOREIGN_KEYS,
    }),
  });

  const snapshotId = body?.data?.snapshot_id;
  if (!snapshotId) {
    throw new Error(`schema-scan response missing snapshot_id: ${JSON.stringify(body)}`);
  }
  return snapshotId;
}

async function waitForSnapshot(snapshotId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < TIMEOUT_MS) {
    const body = await requestJson(`/v1/schema-snapshots/${snapshotId}`);
    const status = body?.data?.status;
    if (status === "ready" || status === "error") {
      return {
        status,
        elapsedMs: Date.now() - startedAt,
        errorCode: body?.data?.error_code || null,
        errorMessage: body?.data?.error_message || null,
      };
    }
    await sleep(POLL_INTERVAL_MS);
  }

  return {
    status: "timeout",
    elapsedMs: TIMEOUT_MS,
    errorCode: "timeout",
    errorMessage: `Timed out waiting ${TIMEOUT_MS}ms`,
  };
}

async function runOnce(index) {
  const snapshotId = await enqueueScan();
  const result = await waitForSnapshot(snapshotId);
  console.log(
    `[run ${index}] snapshot=${snapshotId} status=${result.status} elapsed_ms=${result.elapsedMs}` +
      (result.errorCode ? ` error_code=${result.errorCode}` : ""),
  );
  return result;
}

async function main() {
  if (!ACCESS_TOKEN || !DATA_SOURCE_ID) {
    console.error("Missing PERF_ACCESS_TOKEN or PERF_DATA_SOURCE_ID.");
    process.exit(1);
  }
  if (!Number.isInteger(RUNS) || RUNS <= 0) {
    console.error("PERF_RUNS must be a positive integer.");
    process.exit(1);
  }

  console.log(
    `Running schema scan perf benchmark: runs=${RUNS}, base_url=${BASE_URL}, sample_rows=${SAMPLE_ROWS_PER_TABLE}`,
  );

  const results = [];
  for (let i = 1; i <= RUNS; i += 1) {
    // Sequential runs keep results easier to reason about for p95.
    // Increase parallelism later if needed for stress testing.
    // eslint-disable-next-line no-await-in-loop
    results.push(await runOnce(i));
  }

  const successes = results.filter((r) => r.status === "ready");
  const failures = results.filter((r) => r.status !== "ready");
  const durations = successes.map((r) => r.elapsedMs);
  const p50 = percentile(durations, 50);
  const p95 = percentile(durations, 95);

  console.log("\n=== Schema Scan Performance Summary ===");
  console.log(`successful_runs=${successes.length}`);
  console.log(`failed_runs=${failures.length}`);
  console.log(`p50_ms=${p50 ?? "n/a"}`);
  console.log(`p95_ms=${p95 ?? "n/a"}`);
  console.log(`target_p95_ms=${TARGET_P95_MS}`);

  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of failures) {
      console.log(
        `- status=${failure.status} elapsed_ms=${failure.elapsedMs} error_code=${failure.errorCode ?? "n/a"} error_message=${failure.errorMessage ?? "n/a"}`,
      );
    }
  }

  if (successes.length === 0) {
    console.error("No successful runs; cannot validate p95 target.");
    process.exit(1);
  }

  if ((p95 ?? Number.MAX_SAFE_INTEGER) > TARGET_P95_MS) {
    console.error(`p95 check failed: ${p95}ms > ${TARGET_P95_MS}ms`);
    process.exit(1);
  }

  console.log("p95 check passed.");
}

main().catch((error) => {
  console.error("Schema scan perf benchmark failed:", error);
  process.exit(1);
});
