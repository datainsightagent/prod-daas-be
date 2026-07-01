import { describe, expect, it } from "vitest";

import { parseQueryValidateBody } from "../src/contracts/queries.contract.js";

describe("queries.contract validate body", () => {
  it("accepts sql-only body", () => {
    const parsed = parseQueryValidateBody({
      sql: "SELECT 1",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.sql).toBe("SELECT 1");
  });

  it("rejects body without sql", () => {
    const parsed = parseQueryValidateBody({
      data_source_id: "ds-1",
    });
    expect(parsed.success).toBe(false);
  });
});
