const BLOCKED_SQL_PATTERN =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|MERGE|CALL|GRANT|REVOKE|REPLACE|LOAD_FILE|INTO\s+OUTFILE|INTO\s+DUMPFILE|pg_read_file|pg_ls_dir|pg_read_binary_file)\b/i;

export function stripSqlComments(sql) {
  let result = String(sql || "");
  result = result.replace(/\/\*[\s\S]*?\*\//g, " ");
  result = result.replace(/--[^\n\r]*/g, " ");
  return result;
}

export function normalizeSqlInput(sql) {
  return stripSqlComments(sql).trim().replace(/;\s*$/, "");
}

export function sqlHasTrailingLimit(sql) {
  const normalized = normalizeSqlInput(sql);
  return /\blimit\s+\d+(\s+offset\s+\d+)?\s*$/i.test(normalized);
}

export function buildProbeSelectSql(sql, rowLimit) {
  const trimmed = normalizeSqlInput(sql);
  const safeLimit = Math.max(1, Math.min(Number(rowLimit) || 50, 10_000));

  if (sqlHasTrailingLimit(trimmed)) {
    return {
      sql: trimmed,
      rowLimit: safeLimit,
      capped: false,
    };
  }

  return {
    sql: `SELECT * FROM (${trimmed}) AS di_probe LIMIT ${safeLimit + 1}`,
    rowLimit: safeLimit,
    capped: true,
  };
}

export function isReadOnlySelectStart(sql) {
  const normalized = normalizeSqlInput(sql);
  return /^(WITH\b[\s\S]*\bSELECT\b|SELECT\b)/i.test(normalized);
}

export function countSqlStatements(sql) {
  const normalized = normalizeSqlInput(sql);
  if (!normalized) {
    return 0;
  }
  return normalized
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean).length;
}

export function findBlockedSqlPattern(sql) {
  const normalized = normalizeSqlInput(sql);
  const match = normalized.match(BLOCKED_SQL_PATTERN);
  return match ? match[0] : null;
}

export function inferColumnType(value) {
  if (value === null || value === undefined) {
    return "unknown";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return "number";
  }
  if (value instanceof Date) {
    return "date";
  }
  return "string";
}

export function serializeQueryCell(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("base64");
  }
  return value;
}

export function serializeQueryRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return row;
  }

  const serialized = {};
  for (const [key, value] of Object.entries(row)) {
    serialized[key] = serializeQueryCell(value);
  }
  return serialized;
}

export function buildResultSchema(rows, columnNames = []) {
  const names =
    columnNames.length > 0
      ? columnNames
      : rows.length > 0
        ? Object.keys(rows[0])
        : [];

  const sampleRow = rows[0] ?? {};
  return names.map((name) => ({
    name,
    type: inferColumnType(sampleRow[name]),
  }));
}

export function applyRowCap(rows, rowLimit, capped) {
  if (!capped) {
    return {
      rows,
      truncated: false,
      rowCount: rows.length,
    };
  }

  const truncated = rows.length > rowLimit;
  const sliced = truncated ? rows.slice(0, rowLimit) : rows;
  return {
    rows: sliced,
    truncated,
    rowCount: sliced.length,
  };
}

export function normalizeSelectResult({ rows, columnNames, rowLimit, capped }) {
  const rawRows = Array.isArray(rows) ? rows : [];
  const cappedResult = applyRowCap(rawRows, rowLimit, capped);
  const serializedRows = cappedResult.rows.map((row) => serializeQueryRow(row));

  return {
    schema: buildResultSchema(cappedResult.rows, columnNames),
    rows: serializedRows,
    row_count: cappedResult.rowCount,
    truncated: cappedResult.truncated,
  };
}

export async function runWithQueryTimeout(promise, timeoutMs) {
  const safeTimeout = Math.max(1000, Math.min(Number(timeoutMs) || 30_000, 120_000));

  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error("Query timed out");
          error.code = "QUERY_TIMEOUT";
          reject(error);
        }, safeTimeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
