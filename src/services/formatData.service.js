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

function normalizeCategoryValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  return String(value);
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

function buildSchemaByName(schema) {
  return new Map(
    (Array.isArray(schema) ? schema : []).map((entry) => [entry?.name, entry?.type]),
  );
}

function getRowKeys(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const first = rows[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return [];
  return Object.keys(first);
}

function columnLooksNumeric(key, rows, schemaByName) {
  const schemaType = schemaByName.get(key);
  if (schemaType) {
    const normalized = String(schemaType).toLowerCase();
    if (
      normalized.includes("int") ||
      normalized.includes("decimal") ||
      normalized.includes("numeric") ||
      normalized.includes("float") ||
      normalized.includes("double") ||
      normalized === "number"
    ) {
      return true;
    }
    if (normalized.includes("char") || normalized.includes("text") || normalized === "string") {
      return false;
    }
  }

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    if (!(key in row)) continue;
    const value = row[key];
    if (value === null || value === undefined) continue;
    if (typeof value === "number" || typeof value === "bigint") return true;
    if (typeof value === "string" && Number.isFinite(Number(value.replace(/,/g, "")))) {
      return true;
    }
    return false;
  }

  return false;
}

function findNumericColumns(rowKeys, rows, schemaByName, exclude = []) {
  const excluded = new Set(exclude);
  return rowKeys.filter(
    (key) => !excluded.has(key) && columnLooksNumeric(key, rows, schemaByName),
  );
}

function findNonNumericColumns(rowKeys, rows, schemaByName, exclude = []) {
  const excluded = new Set(exclude);
  return rowKeys.filter(
    (key) => !excluded.has(key) && !columnLooksNumeric(key, rows, schemaByName),
  );
}

function pickBestMeasureColumn(numericColumns) {
  if (numericColumns.length === 0) return null;
  const preferred = numericColumns.find((key) => columnLooksLikeMeasure(key));
  return preferred ?? numericColumns[numericColumns.length - 1];
}

function columnLooksLikeMeasure(key) {
  if (/_id$|^id$/i.test(key)) return false;
  return /total|count|sum|amount|qty|quantity|revenue|value|payment/i.test(key);
}

function columnLooksLikeDimension(key) {
  return (
    /_id$|^id$/i.test(key) ||
    /method|category|type|name|month|year|day|week|source|status|region|segment/i.test(key)
  );
}

function collectUniqueValues(rows, field) {
  const values = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    if (!(field in row)) continue;
    const value = normalizeCategoryValue(row[field]);
    const token = String(value);
    if (seen.has(token)) continue;
    seen.add(token);
    values.push(value);
  }
  return values;
}

function resolveSeriesLabel(configuredSeries, fallbackKey) {
  const configured = Array.isArray(configuredSeries) ? configuredSeries : [];
  const match =
    configured.find((entry) => entry?.key === fallbackKey) ??
    configured.find(
      (entry) =>
        typeof entry?.key === "string" &&
        entry.key.toLowerCase() === String(fallbackKey).toLowerCase(),
    );
  if (match?.label) return match.label;
  if (match?.key) return match.key;
  return String(fallbackKey);
}

function resolveXyFields(spec, rows, schema) {
  const schemaByName = buildSchemaByName(schema);
  const rowKeys = getRowKeys(rows);
  const dataMap = spec?.data_map ?? {};

  if (spec.type === "row") {
    let categoryField = dataMap.y_field;
    let measureField = dataMap.x_field;

    if (!rowKeys.includes(categoryField)) {
      const nonNumeric = findNonNumericColumns(rowKeys, rows, schemaByName);
      categoryField =
        nonNumeric[0] ??
        rowKeys.find((key) => key !== measureField) ??
        categoryField;
    }
    if (!rowKeys.includes(measureField) || !columnLooksNumeric(measureField, rows, schemaByName)) {
      const numeric = findNumericColumns(rowKeys, rows, schemaByName, [categoryField]);
      measureField = pickBestMeasureColumn(numeric) ?? measureField;
    }
    if (!rowKeys.includes(categoryField) && rowKeys.length >= 2) {
      categoryField = rowKeys.find((key) => key !== measureField) ?? categoryField;
    }

    return {
      categoryField,
      measureField,
      seriesField: null,
    };
  }

  let xField = dataMap.x_field;
  let yField = dataMap.y_field;
  let seriesField = dataMap.series_field ?? null;

  if (!rowKeys.includes(xField)) {
    const nonNumeric = findNonNumericColumns(rowKeys, rows, schemaByName, [yField, seriesField]);
    xField = nonNumeric[0] ?? xField;
  }

  const yIsNumeric = rowKeys.includes(yField) && columnLooksNumeric(yField, rows, schemaByName);
  const numericColumns = findNumericColumns(rowKeys, rows, schemaByName, [xField]);
  const measureColumns = numericColumns.filter((key) => columnLooksLikeMeasure(key));
  const bestMeasure = pickBestMeasureColumn(
    measureColumns.length > 0 ? measureColumns : numericColumns,
  );

  const yLooksLikeDimension =
    rowKeys.includes(yField) &&
    yField !== xField &&
    !columnLooksLikeMeasure(yField) &&
    (columnLooksLikeDimension(yField) ||
      (yIsNumeric && numericColumns.length > 1 && yField !== bestMeasure));

  if (yLooksLikeDimension && bestMeasure && yField !== bestMeasure) {
    if (!seriesField) {
      seriesField = yField;
    }
    yField = bestMeasure;
  } else if (!yIsNumeric) {
    const measureField = bestMeasure;

    if (!seriesField && yField && rowKeys.includes(yField) && yField !== xField) {
      seriesField = yField;
    }

    if (measureField) {
      yField = measureField;
    }
  }

  if (!seriesField) {
    const extraDimensions = findNonNumericColumns(rowKeys, rows, schemaByName, [xField, yField]);
    if (extraDimensions.length === 1) {
      seriesField = extraDimensions[0];
    }
  }

  if (seriesField === xField || seriesField === yField) {
    seriesField = null;
  }

  return normalizeXyFieldRoles({
    categoryField: xField,
    measureField: yField,
    seriesField,
    rowKeys,
    rows,
    schemaByName,
  });
}

function normalizeXyFieldRoles({
  categoryField,
  measureField,
  seriesField,
  rowKeys,
  rows,
  schemaByName,
}) {
  if (
    seriesField &&
    measureField &&
    columnLooksLikeMeasure(seriesField) &&
    !columnLooksLikeMeasure(measureField)
  ) {
    return {
      categoryField,
      measureField: seriesField,
      seriesField: measureField,
    };
  }

  if (!seriesField) {
    const numericColumns = findNumericColumns(rowKeys, rows, schemaByName, [categoryField]);
    const measureCol = pickBestMeasureColumn(
      numericColumns.filter((key) => columnLooksLikeMeasure(key)),
    );
    const dimensionCols = numericColumns.filter(
      (key) =>
        key !== measureCol &&
        (columnLooksLikeDimension(key) || !columnLooksLikeMeasure(key)),
    );

    if (measureCol && dimensionCols.length === 1) {
      return {
        categoryField,
        measureField: measureCol,
        seriesField: dimensionCols[0],
      };
    }
  }

  return { categoryField, measureField, seriesField };
}

function formatSeriesName(configuredSeries, seriesKey) {
  const label = resolveSeriesLabel(configuredSeries, seriesKey);
  const token = String(seriesKey);
  if (label === token && /^\d+$/.test(token)) {
    return `Method ${token}`;
  }
  return label;
}

function measureValueForCategory(rows, categoryField, categoryValue, measureField) {
  const matches = rows.filter(
    (row) =>
      row &&
      typeof row === "object" &&
      !Array.isArray(row) &&
      String(row[categoryField]) === String(categoryValue),
  );

  if (matches.length === 0) return null;
  if (matches.length === 1) return toNumberOrNull(matches[0][measureField]);

  return matches.reduce((sum, row) => sum + (toNumberOrNull(row[measureField]) ?? 0), 0);
}

function formatXyDataset(spec, rows, schema) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const { categoryField, measureField, seriesField } = resolveXyFields(spec, safeRows, schema);
  const configuredSeries = spec?.config?.display?.series ?? [];
  const categories = collectUniqueValues(safeRows, categoryField);

  if (seriesField) {
    const seriesKeys = collectUniqueValues(safeRows, seriesField);
    const series = seriesKeys.map((seriesKey) => ({
      name: formatSeriesName(configuredSeries, seriesKey),
      data: categories.map((category) => {
        const match = safeRows.find(
          (row) =>
            row &&
            typeof row === "object" &&
            !Array.isArray(row) &&
            String(row[categoryField]) === String(category) &&
            String(row[seriesField]) === String(seriesKey),
        );
        return match ? toNumberOrNull(match[measureField]) : null;
      }),
    }));

    return { categories, series };
  }

  const seriesLabel = resolveSeriesLabel(
    configuredSeries,
    configuredSeries[0]?.key ?? measureField,
  );
  const data = categories.map((category) =>
    measureValueForCategory(safeRows, categoryField, category, measureField),
  );

  return {
    categories,
    series: [{ name: seriesLabel, data }],
  };
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
    case "bar":
    case "line":
    case "row":
      return formatXyDataset(spec, rows, schema);
    default:
      throw new Error(`Unsupported component type: ${spec.type}`);
  }
}

