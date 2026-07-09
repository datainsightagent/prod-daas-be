function normalizeDatasetType(type) {
  if (type === "number" || type === "boolean" || type === "date" || type === "string") {
    return type;
  }
  return "string";
}

function inferTypeFromValue(value) {
  if (value === null || value === undefined) return "string";
  if (typeof value === "number" || typeof value === "bigint") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value instanceof Date) return "date";
  return "string";
}

function inferColumnType({ key, rows, schemaByName }) {
  const fromSchema = schemaByName.get(key);
  if (fromSchema) {
    return normalizeDatasetType(String(fromSchema).toLowerCase());
  }

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    if (!(key in row)) continue;
    const value = row[key];
    if (value === null || value === undefined) continue;
    return normalizeDatasetType(inferTypeFromValue(value));
  }

  return "string";
}

function toNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatValueDataset(spec, rows) {
  const firstRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  const field = spec?.data_map?.value_field;
  const label = spec?.data_map?.label;

  const rawValue =
    firstRow && typeof firstRow === "object" && !Array.isArray(firstRow)
      ? firstRow[field]
      : null;

  return {
    value: toNumberOrNull(rawValue),
    label,
  };
}

function orderColumnsByConfig(columnKeys, configuredColumns) {
  if (!Array.isArray(configuredColumns) || configuredColumns.length === 0) {
    return columnKeys;
  }

  const configuredKeys = configuredColumns
    .map((col) => col?.key)
    .filter((key) => typeof key === "string" && key.trim().length > 0);
  if (configuredKeys.length === 0) {
    return columnKeys;
  }

  const columnKeySet = new Set(columnKeys);
  const ordered = configuredKeys.filter((key) => columnKeySet.has(key));
  for (const key of columnKeys) {
    if (!ordered.includes(key)) {
      ordered.push(key);
    }
  }

  return ordered.length > 0 ? ordered : columnKeys;
}

function formatTableDataset(spec, rows, schema, opts = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const selectedColumns = Array.isArray(spec?.data_map?.columns)
    ? spec.data_map.columns.filter((col) => typeof col === "string" && col.trim().length > 0)
    : [];
  const configuredColumns = Array.isArray(spec?.config?.columns) ? spec.config.columns : [];
  const configuredByKey = new Map(configuredColumns.map((col) => [col.key, col]));
  const schemaByName = new Map(
    (Array.isArray(schema) ? schema : []).map((entry) => [entry?.name, entry?.type]),
  );

  const fallbackColumnsFromSchema = (Array.isArray(schema) ? schema : [])
    .map((entry) => (typeof entry?.name === "string" ? entry.name : ""))
    .filter(Boolean);
  const fallbackColumnsFromRows =
    safeRows.length > 0 && safeRows[0] && typeof safeRows[0] === "object" && !Array.isArray(safeRows[0])
      ? Object.keys(safeRows[0])
      : [];

  const requestedColumnsValid =
    selectedColumns.length > 0 &&
    selectedColumns.some((key) => schemaByName.has(key) || fallbackColumnsFromRows.includes(key));

  const rawEffectiveColumns = requestedColumnsValid
    ? selectedColumns
    : fallbackColumnsFromSchema.length > 0
      ? fallbackColumnsFromSchema
      : fallbackColumnsFromRows;

  const effectiveColumns = orderColumnsByConfig(rawEffectiveColumns, configuredColumns);

  const columns = effectiveColumns.map((key) => {
    const config = configuredByKey.get(key);
    return {
      key,
      label: config?.label ?? key,
      type: inferColumnType({ key, rows: safeRows, schemaByName }),
    };
  });

  const normalizedRows = safeRows.map((row) => {
    const output = {};
    for (const column of effectiveColumns) {
      output[column] =
        row && typeof row === "object" && !Array.isArray(row) && column in row
          ? row[column]
          : null;
    }
    return output;
  });

  const limit = spec?.config?.pagination?.page_size ?? 11;
  const total = Number.isInteger(opts.rowCount) ? opts.rowCount : normalizedRows.length;

  return {
    columns,
    rows: normalizedRows,
    page: {
      offset: 0,
      limit,
      total,
    },
  };
}

export function formatData(spec, rows, schema, opts = {}) {
  if (!spec || typeof spec !== "object") {
    throw new Error("Invalid component spec");
  }

  switch (spec.type) {
    case "value":
      return formatValueDataset(spec, rows);
    case "table":
      return formatTableDataset(spec, rows, schema, opts);
    default:
      throw new Error(`Unsupported component type: ${spec.type}`);
  }
}

