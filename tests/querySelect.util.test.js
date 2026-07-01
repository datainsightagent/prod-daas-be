import { describe, expect, it } from "vitest";

import {
  applyRowCap,
  buildProbeSelectSql,
  normalizeSqlInput,
  serializeQueryRow,
  sqlHasTrailingLimit,
} from "../src/lib/db-connectors/querySelect.util.js";

describe("querySelect.util", () => {
  it("detects trailing LIMIT", () => {
    expect(sqlHasTrailingLimit("SELECT 1 LIMIT 10")).toBe(true);
    expect(sqlHasTrailingLimit("SELECT 1 LIMIT 10 OFFSET 5")).toBe(true);
    expect(sqlHasTrailingLimit("SELECT 1")).toBe(false);
  });

  it("wraps SQL without LIMIT using probe subquery", () => {
    const built = buildProbeSelectSql("SELECT id FROM customers", 50);
    expect(built.capped).toBe(true);
    expect(built.sql).toContain("AS di_probe LIMIT 51");
  });

  it("keeps SQL that already has LIMIT", () => {
    const built = buildProbeSelectSql("SELECT id FROM customers LIMIT 5", 50);
    expect(built.capped).toBe(false);
    expect(built.sql).toBe("SELECT id FROM customers LIMIT 5");
  });

  it("strips line and block comments before checks", () => {
    const normalized = normalizeSqlInput(`
      -- leading comment
      SELECT /* inline */ 1
    `);
    expect(normalized.replace(/\s+/g, " ")).toBe("SELECT 1");
  });

  it("applies row cap when probe wrapper fetched extra row", () => {
    const capped = applyRowCap([{ id: 1 }, { id: 2 }, { id: 3 }], 2, true);
    expect(capped.truncated).toBe(true);
    expect(capped.rowCount).toBe(2);
    expect(capped.rows).toHaveLength(2);
  });

  it("serializes dates and buffers for JSON storage", () => {
    const row = serializeQueryRow({
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      payload: Buffer.from("abc"),
    });
    expect(row.created_at).toBe("2026-01-01T00:00:00.000Z");
    expect(row.payload).toBe("YWJj");
  });
});
