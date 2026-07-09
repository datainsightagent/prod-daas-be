import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseComponentSpec } from "../src/contracts/componentSpec.contract.js";
import { parseDataset } from "../src/contracts/componentDataset.contract.js";
import { formatData } from "../src/services/formatData.service.js";

const FIXTURES = join(process.cwd(), "fixtures", "text2component");

function loadJson(name) {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

describe("formatData.service", () => {
  it("formats value dataset from first row", () => {
    const specRaw = loadJson("component_spec.value.json");
    const expected = loadJson("dataset.value.json");
    const parsed = parseComponentSpec(specRaw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const rows = [{ count: 262028 }];
    const schema = [{ name: "count", type: "number" }];

    const dataset = formatData(parsed.data, rows, schema, { rowCount: rows.length });

    expect(dataset).toEqual(expected);
    const validated = parseDataset("value", dataset);
    expect(validated.success).toBe(true);
  });

  it("returns null value for empty value result", () => {
    const specRaw = loadJson("component_spec.value.json");
    const parsed = parseComponentSpec(specRaw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const dataset = formatData(parsed.data, [], [], { rowCount: 0 });
    expect(dataset).toEqual({
      value: null,
      label: "Total Inquiries",
    });
  });

  it("formats table dataset using selected columns and schema", () => {
    const specRaw = loadJson("component_spec.table.json");
    const expected = loadJson("dataset.table.json");
    const parsed = parseComponentSpec(specRaw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const rows = [
      { source: "Word of Mouth", count: 18327, ignored: "x" },
      { source: "Facebook", count: 7100, ignored: "y" },
      { source: "Google", count: 5200, ignored: "z" },
    ];
    const schema = [
      { name: "source", type: "string" },
      { name: "count", type: "number" },
      { name: "ignored", type: "string" },
    ];

    const dataset = formatData(parsed.data, rows, schema, { rowCount: rows.length });

    expect(dataset).toEqual(expected);
    const validated = parseDataset("table", dataset);
    expect(validated.success).toBe(true);
  });

  it("uses rowCount metadata for table pagination total", () => {
    const specRaw = loadJson("component_spec.table.json");
    const parsed = parseComponentSpec(specRaw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const rows = [{ source: "Google", count: 10 }];
    const schema = [
      { name: "source", type: "string" },
      { name: "count", type: "number" },
    ];

    const dataset = formatData(parsed.data, rows, schema, { rowCount: 123 });
    expect(dataset.page.total).toBe(123);
    expect(dataset.page.limit).toBe(11);
  });

  it("throws for unsupported component type", () => {
    const spec = {
      type: "line",
      data_map: { x_field: "x", y_field: "y", series_field: null },
      config: {},
    };

    expect(() => formatData(spec, [], [], {})).toThrow(
      "Unsupported component type: line",
    );
  });
});

