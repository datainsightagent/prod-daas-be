import { describe, expect, it } from "vitest";
import { parseKbRetrieveBody } from "../src/contracts/kbRetrieve.contract.js";

describe("kbRetrieve.contract", () => {
  it("parses a valid body", () => {
    const r = parseKbRetrieveBody({
      query: " what is status ",
      limit: 5,
      types: ["glossary", "business_rule"],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.query).toBe("what is status");
      expect(r.data.limit).toBe(5);
      expect(r.data.types).toEqual(["glossary", "business_rule"]);
    }
  });

  it("strips tenant_id from body", () => {
    const r = parseKbRetrieveBody({
      query: "x",
      tenant_id: "evil",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).not.toHaveProperty("tenant_id");
    }
  });

  it("rejects empty query", () => {
    const r = parseKbRetrieveBody({ query: "   " });
    expect(r.success).toBe(false);
  });

  it("accepts optional min_similarity (PRD-04 notebook parity)", () => {
    const r = parseKbRetrieveBody({
      query: "revenue",
      min_similarity: 0.25,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.min_similarity).toBe(0.25);
    }
  });

  it("rejects min_similarity out of [-1, 1]", () => {
    const r = parseKbRetrieveBody({ query: "x", min_similarity: 1.5 });
    expect(r.success).toBe(false);
  });
});
