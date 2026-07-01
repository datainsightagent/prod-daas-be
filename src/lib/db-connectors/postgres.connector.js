import pg from "pg";
import {
  buildProbeSelectSql,
  normalizeSelectResult,
  runWithQueryTimeout,
} from "./querySelect.util.js";

const { Client } = pg;

export async function withPostgresConnection(config, callback) {
  const client = new Client({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.databaseName,
    connectionTimeoutMillis: 3000,
  });

  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

export async function postgresInfoQuery(config) {
  return withPostgresConnection(config, async (client) => {
    const result = await client.query("SELECT version() AS version");
    return result?.rows?.[0]?.version ?? null;
  });
}

export async function verifyPostgresReadOnly(config) {
  return withPostgresConnection(config, async (client) => {
    await client.query("CREATE TEMP TABLE __di_prd02_probe(id INT)");
    await client.query("DROP TABLE __di_prd02_probe");
  });
}

/**
 * Execute a validated read-only SELECT and return schema + capped rows.
 */
export async function runPostgresSelectQuery(
  config,
  { sql, rowLimit, timeoutMs = 30_000 },
) {
  const { sql: executableSql, rowLimit: safeLimit, capped } = buildProbeSelectSql(
    sql,
    rowLimit,
  );

  return withPostgresConnection(config, async (client) => {
    const result = await runWithQueryTimeout(
      client.query(executableSql),
      timeoutMs,
    );

    const columnNames = Array.isArray(result?.fields)
      ? result.fields.map((field) => String(field.name))
      : [];

    return normalizeSelectResult({
      rows: result?.rows ?? [],
      columnNames,
      rowLimit: safeLimit,
      capped,
    });
  });
}
