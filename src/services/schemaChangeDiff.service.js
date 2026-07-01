function normalizeTableName(value) {
  return String(value || "").trim();
}

function normalizeColumnName(value) {
  return String(value || "").trim();
}

function normalizeColumnType(value) {
  return String(value || "").trim().toLowerCase();
}

function toTableMap(payload) {
  const tableMap = new Map();
  const tables = Array.isArray(payload?.tables) ? payload.tables : [];

  for (const table of tables) {
    const tableName = normalizeTableName(table?.table_name);
    if (!tableName) {
      continue;
    }

    const columnMap = new Map();
    const columns = Array.isArray(table?.columns) ? table.columns : [];
    for (const column of columns) {
      const columnName = normalizeColumnName(column?.name);
      if (!columnName) {
        continue;
      }

      columnMap.set(columnName, {
        name: columnName,
        type: normalizeColumnType(column?.type),
      });
    }

    tableMap.set(tableName, {
      tableName,
      columnMap,
    });
  }

  return tableMap;
}

function buildEvent({
  changeType,
  severity,
  tableName = null,
  columnName = null,
  oldValue = null,
  newValue = null,
}) {
  return {
    changeType,
    severity,
    tableName,
    columnName,
    oldValue,
    newValue,
  };
}

export function computeSchemaDiff(previousPayload, currentPayload) {
  const previousTableMap = toTableMap(previousPayload);
  const currentTableMap = toTableMap(currentPayload);
  const events = [];

  for (const [tableName, previousTable] of previousTableMap.entries()) {
    const currentTable = currentTableMap.get(tableName);
    if (!currentTable) {
      events.push(
        buildEvent({
          changeType: "table_removed",
          severity: "critical",
          tableName,
          oldValue: { table_name: tableName },
          newValue: null,
        }),
      );
      continue;
    }

    for (const [columnName, previousColumn] of previousTable.columnMap.entries()) {
      const currentColumn = currentTable.columnMap.get(columnName);
      if (!currentColumn) {
        events.push(
          buildEvent({
            changeType: "column_removed",
            severity: "critical",
            tableName,
            columnName,
            oldValue: { type: previousColumn.type || null },
            newValue: null,
          }),
        );
        continue;
      }

      if (previousColumn.type !== currentColumn.type) {
        events.push(
          buildEvent({
            changeType: "column_type_changed",
            severity: "critical",
            tableName,
            columnName,
            oldValue: { type: previousColumn.type || null },
            newValue: { type: currentColumn.type || null },
          }),
        );
      }
    }
  }

  for (const [tableName, currentTable] of currentTableMap.entries()) {
    const previousTable = previousTableMap.get(tableName);
    if (!previousTable) {
      events.push(
        buildEvent({
          changeType: "table_added",
          severity: "info",
          tableName,
          oldValue: null,
          newValue: { table_name: tableName },
        }),
      );
      continue;
    }

    for (const [columnName, currentColumn] of currentTable.columnMap.entries()) {
      if (!previousTable.columnMap.has(columnName)) {
        events.push(
          buildEvent({
            changeType: "column_added",
            severity: "info",
            tableName,
            columnName,
            oldValue: null,
            newValue: { type: currentColumn.type || null },
          }),
        );
      }
    }
  }

  return events;
}
