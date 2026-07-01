import { describe, expect, it } from "vitest";

import { validateReadOnlySql } from "../src/services/queryValidation.service.js";

describe("queryValidation.service", () => {
  it("accepts Hammaad-style aggregate SELECT", () => {
    const result = validateReadOnlySql(
      "SELECT COUNT(*) AS customer_count FROM customers WHERE created_at >= '2025-04-01' AND created_at <= '2026-04-09'",
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts WITH ... SELECT queries", () => {
    const result = validateReadOnlySql(`
      WITH recent AS (
        SELECT id FROM customers WHERE active = 1
      )
      SELECT COUNT(*) AS total FROM recent
    `);
    expect(result.valid).toBe(true);
  });

  it("rejects empty SQL", () => {
    const result = validateReadOnlySql("   ");
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("empty_sql");
  });

  it("rejects multi-statement SQL", () => {
    const result = validateReadOnlySql("SELECT 1; SELECT 2");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "multiple_statements")).toBe(true);
  });

  it("rejects write statements", () => {
    const deleteResult = validateReadOnlySql("DELETE FROM customers");
    expect(deleteResult.valid).toBe(false);
    expect(deleteResult.errors.some((e) => e.code === "not_select")).toBe(true);

    const insertResult = validateReadOnlySql("INSERT INTO customers VALUES (1)");
    expect(insertResult.valid).toBe(false);
    expect(
      insertResult.errors.some((e) => e.code === "write_or_unsafe_statement"),
    ).toBe(true);
  });

  it("rejects dangerous functions", () => {
    const result = validateReadOnlySql("SELECT LOAD_FILE('/etc/passwd')");
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.code === "write_or_unsafe_statement"),
    ).toBe(true);
  });
});
