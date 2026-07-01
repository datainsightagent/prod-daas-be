# Schema Scan Performance Check (PRD-03)

Use this check to validate PRD-03 target:

- p95 scan duration for a 50-table schema with 3 sample rows/table is less than 60s.

## Prerequisites

- API server running: `npm run dev`
- Schema worker running: `npm run dev:worker:schema-scan`
- A connected MySQL datasource with representative schema size
- Valid tenant-admin JWT

## Environment variables

- `PERF_ACCESS_TOKEN` (required)
- `PERF_DATA_SOURCE_ID` (required)
- `PERF_BASE_URL` (default: `http://localhost:5000`)
- `PERF_RUNS` (default: `10`)
- `PERF_SAMPLE_ROWS_PER_TABLE` (default: `3`)
- `PERF_INCLUDE_FOREIGN_KEYS` (default: `true`)
- `PERF_POLL_INTERVAL_MS` (default: `1000`)
- `PERF_TIMEOUT_MS` (default: `120000`)
- `PERF_TARGET_P95_MS` (default: `60000`)

## Run

Example (PowerShell):

```powershell
$env:PERF_ACCESS_TOKEN = "<jwt>"
$env:PERF_DATA_SOURCE_ID = "<data_source_id>"
$env:PERF_RUNS = "10"
npm run perf:schema-scan
```

## Output

The script prints per-run status and final summary:

- `successful_runs`
- `failed_runs`
- `p50_ms`
- `p95_ms`
- pass/fail result for `PERF_TARGET_P95_MS`

The command exits non-zero when:

- no successful runs complete, or
- computed p95 exceeds target, or
- request/timeout failures occur.
