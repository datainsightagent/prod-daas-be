import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseComponentSpec } from "../src/contracts/componentSpec.contract.js";
import { parseDataset } from "../src/contracts/componentDataset.contract.js";

const FIXTURES = join(process.cwd(), "fixtures", "text2component");

function loadJson(name) {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

describe("componentSpec.contract G0", () => {
  for (const type of ["value", "line", "bar", "row", "pie", "table"]) {
    it(`parses component_spec.${type}.json`, () => {
      const spec = loadJson(`component_spec.${type}.json`);
      const result = parseComponentSpec(spec);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(type);
        expect(result.data.spec_version).toBe(2);
      }
    });

    it(`parses dataset.${type}.json`, () => {
      const dataset = loadJson(`dataset.${type}.json`);
      const result = parseDataset(type, dataset);
      expect(result.success).toBe(true);
    });
  }

  it("rejects invalid spec_version", () => {
    const spec = loadJson("component_spec.bar.json");
    const result = parseComponentSpec({ ...spec, spec_version: 1 });
    expect(result.success).toBe(false);
  });

  it("parses empty bar spec fixture", () => {
    const spec = loadJson("component_spec.empty.json");
    const result = parseComponentSpec(spec);
    expect(result.success).toBe(true);
  });
});
