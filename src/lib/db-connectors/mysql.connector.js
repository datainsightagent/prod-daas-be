import mysql from "mysql2/promise";
import {
  buildProbeSelectSql,
  normalizeSelectResult,
  runWithQueryTimeout,
} from "./querySelect.util.js";

export async function withMysqlConnection(config, callback) {
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.databaseName,
    connectTimeout: 3000,
  });

  try {
    return await callback(connection);
  } finally {
    await connection.end();
  }
}

export async function mysqlInfoQuery(config) {
  return withMysqlConnection(config, async (connection) => {
    const [rows] = await connection.query("SELECT VERSION() AS version");
    return rows?.[0]?.version ?? null;
  });
}

export async function verifyMysqlReadOnly(config) {
  return withMysqlConnection(config, async (connection) => {
    // Temporary table creation is a portable write-permission probe for MySQL.
    await connection.query(
      "CREATE TEMPORARY TABLE __di_prd02_probe(id INT) ENGINE=MEMORY",
    );
    await connection.query("DROP TEMPORARY TABLE __di_prd02_probe");
  });
}

function toSafeIntegerOrNull(value) {
  if (value == null) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return Math.trunc(numeric);
}

function readField(row, ...keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) {
      return row[key];
    }
  }
  return null;
}

function quoteMysqlIdentifier(identifier) {
  return `\`${String(identifier).replaceAll("`", "``")}\``;
}

function pushGroupedRow(map, key, row) {
  const list = map.get(key);
  if (list) {
    list.push(row);
  } else {
    map.set(key, [row]);
  }
}

function buildGroupedMap(rows, ...keyCandidates) {
  const grouped = new Map();
  for (const row of rows) {
    const raw = readField(row, ...keyCandidates);
    if (!raw) {
      continue;
    }
    pushGroupedRow(grouped, String(raw), row);
  }
  return grouped;
}

async function runWithConcurrencyLimit(items, limit, worker) {
  const safeLimit = Math.max(1, Number(limit) || 1);
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runOne() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from(
    { length: Math.min(safeLimit, items.length) },
    () => runOne(),
  );
  await Promise.all(runners);
  return results;
}

export async function scanMysqlSchema(config, options = {}) {
  const sampleRowsPerTable = Number.isInteger(options.sampleRowsPerTable)
    ? options.sampleRowsPerTable
    : 3;
  const includeForeignKeys = options.includeForeignKeys !== false;
  const sampleRowsConcurrency = Number.isInteger(options.sampleRowsConcurrency)
    ? options.sampleRowsConcurrency
    : 4;

  return withMysqlConnection(config, async (connection) => {
    const [tableRows] = await connection.query(
      `
      SELECT
        table_name AS table_name,
        table_rows AS table_rows
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_type = 'BASE TABLE'
      ORDER BY table_name ASC
      `,
    );

    const tableDefs = tableRows
      .map((tableRow) => {
        const rawTableName = readField(tableRow, "table_name", "TABLE_NAME");
        if (!rawTableName) {
          return null;
        }
        return {
          tableName: String(rawTableName),
          rowEstimate: toSafeIntegerOrNull(readField(tableRow, "table_rows", "TABLE_ROWS")),
        };
      })
      .filter(Boolean);

    const [allColumnsRows, allPrimaryKeyRows, allForeignKeyRows] = await Promise.all([
      connection.query(
        `
        SELECT
          table_name AS table_name,
          column_name AS column_name,
          data_type AS data_type,
          is_nullable AS is_nullable,
          column_key AS column_key
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
        ORDER BY table_name ASC, ordinal_position ASC
        `,
      ),
      connection.query(
        `
        SELECT
          table_name AS table_name,
          column_name AS column_name
        FROM information_schema.key_column_usage
        WHERE table_schema = DATABASE()
          AND constraint_name = 'PRIMARY'
        ORDER BY table_name ASC, ordinal_position ASC
        `,
      ),
      includeForeignKeys
        ? connection.query(
            `
            SELECT
              table_name AS table_name,
              column_name AS column_name,
              referenced_table_name AS referenced_table_name,
              referenced_column_name AS referenced_column_name
            FROM information_schema.key_column_usage
            WHERE table_schema = DATABASE()
              AND referenced_table_name IS NOT NULL
            ORDER BY table_name ASC, ordinal_position ASC
            `,
          )
        : Promise.resolve([[]]),
    ]);

    const columnsByTable = buildGroupedMap(allColumnsRows[0], "table_name", "TABLE_NAME");
    const primaryKeysByTable = buildGroupedMap(
      allPrimaryKeyRows[0],
      "table_name",
      "TABLE_NAME",
    );
    const foreignKeysByTable = buildGroupedMap(
      allForeignKeyRows[0],
      "table_name",
      "TABLE_NAME",
    );

    const sampleRowsByTable = new Map();
    if (sampleRowsPerTable > 0 && tableDefs.length > 0) {
      await runWithConcurrencyLimit(
        tableDefs,
        sampleRowsConcurrency,
        async ({ tableName }) => {
          const tableIdentifier = quoteMysqlIdentifier(tableName);
          const [rows] = await connection.query(
            `SELECT * FROM ${tableIdentifier} LIMIT ?`,
            [sampleRowsPerTable],
          );
          sampleRowsByTable.set(tableName, rows);
        },
      );
    }

    const tables = tableDefs.map(({ tableName, rowEstimate }) => ({
      table_name: tableName,
      row_estimate: rowEstimate,
      columns: (columnsByTable.get(tableName) || []).map((column) => ({
        name: String(readField(column, "column_name", "COLUMN_NAME")),
        type: String(readField(column, "data_type", "DATA_TYPE")),
        nullable:
          String(readField(column, "is_nullable", "IS_NULLABLE")).toUpperCase() === "YES",
        is_primary_key:
          String(readField(column, "column_key", "COLUMN_KEY")).toUpperCase() === "PRI",
      })),
      primary_key: (primaryKeysByTable.get(tableName) || []).map((pk) =>
        String(readField(pk, "column_name", "COLUMN_NAME")),
      ),
      foreign_keys: includeForeignKeys
        ? (foreignKeysByTable.get(tableName) || []).map((row) => ({
            column: String(readField(row, "column_name", "COLUMN_NAME")),
            ref_table: String(
              readField(row, "referenced_table_name", "REFERENCED_TABLE_NAME"),
            ),
            ref_column: String(
              readField(row, "referenced_column_name", "REFERENCED_COLUMN_NAME"),
            ),
          }))
        : [],
      sample_rows: sampleRowsByTable.get(tableName) || [],
    }));

    return { tables };
  });
}

/**
 * Execute a validated read-only SELECT and return schema + capped rows.
 */
export async function runMysqlSelectQuery(
  config,
  { sql, rowLimit, timeoutMs = 30_000 },
) {
  const { sql: executableSql, rowLimit: safeLimit, capped } = buildProbeSelectSql(
    sql,
    rowLimit,
  );

  return withMysqlConnection(config, async (connection) => {
    const [rows, fields] = await runWithQueryTimeout(
      connection.query(executableSql),
      timeoutMs,
    );

    const columnNames = Array.isArray(fields)
      ? fields.map((field) => String(field.name))
      : [];

    return normalizeSelectResult({
      rows,
      columnNames,
      rowLimit: safeLimit,
      capped,
    });
  });
}
