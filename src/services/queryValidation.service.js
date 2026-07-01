import {
  countSqlStatements,
  findBlockedSqlPattern,
  isReadOnlySelectStart,
  normalizeSqlInput,
} from "../lib/db-connectors/querySelect.util.js";

function pushError(errors, code, message) {
  errors.push({ code, message });
}

/**
 * Lightweight read-only SQL validation for AI probe queries.
 * Fail closed — invalid SQL must not reach execution.
 */
export function validateReadOnlySql(sql) {
  const errors = [];
  const normalized = normalizeSqlInput(sql);

  if (!normalized) {
    pushError(errors, "empty_sql", "SQL must not be empty");
    return { valid: false, errors };
  }

  if (countSqlStatements(sql) > 1) {
    pushError(errors, "multiple_statements", "Only a single SQL statement is allowed");
  }

  if (!isReadOnlySelectStart(sql)) {
    pushError(
      errors,
      "not_select",
      "Only read-only SELECT queries are allowed",
    );
  }

  const blocked = findBlockedSqlPattern(sql);
  if (blocked) {
    pushError(
      errors,
      "write_or_unsafe_statement",
      `Unsafe SQL pattern is not allowed: ${blocked}`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
