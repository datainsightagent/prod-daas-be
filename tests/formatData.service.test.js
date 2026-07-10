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

  it("formats Option A table spec with config column labels", () => {
    const specRaw = loadJson("component_spec.table.products_by_category.json");
    const parsed = parseComponentSpec(specRaw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const rows = [
      { category: "Electronics", product_count: 42 },
      { category: "Books", product_count: 18 },
    ];
    const schema = [
      { name: "category", type: "string" },
      { name: "product_count", type: "number" },
    ];

    const dataset = formatData(parsed.data, rows, schema, { rowCount: rows.length });

    expect(dataset.columns).toEqual([
      { key: "category", label: "Category", type: "string" },
      { key: "product_count", label: "Product Count", type: "number" },
    ]);
    expect(dataset.rows).toEqual(rows);
    expect(dataset.page.limit).toBe(11);
  });

  it("falls back to real schema columns when requested table columns are invalid", () => {
    const specRaw = loadJson("component_spec.table.json");
    const parsed = parseComponentSpec(specRaw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const invalidSpec = {
      ...parsed.data,
      data_map: { columns: ["value"] },
      config: {
        ...parsed.data.config,
        columns: [{ key: "value", label: "value", visible: true, align: "left" }],
      },
    };

    const rows = [
      { name: "Alice", order_count: 5 },
      { name: "Bob", order_count: 4 },
    ];
    const schema = [
      { name: "name", type: "string" },
      { name: "order_count", type: "number" },
    ];

    const dataset = formatData(invalidSpec, rows, schema, { rowCount: rows.length });
    expect(dataset.columns.map((c) => c.key)).toEqual(["name", "order_count"]);
    expect(dataset.rows[0]).toEqual({ name: "Alice", order_count: 5 });
  });

  it("formats bar dataset from x/y fields", () => {
    const specRaw = loadJson("component_spec.bar.json");
    const expected = loadJson("dataset.bar.json");
    const parsed = parseComponentSpec(specRaw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const rows = [
      { source: "Word of Mouth", count: 18300 },
      { source: "Facebook", count: 7100 },
      { source: "Google", count: 5200 },
    ];
    const schema = [
      { name: "source", type: "string" },
      { name: "count", type: "number" },
    ];

    const dataset = formatData(parsed.data, rows, schema, { rowCount: rows.length });

    expect(dataset).toEqual(expected);
    const validated = parseDataset("bar", dataset);
    expect(validated.success).toBe(true);
  });

  it("formats line dataset from x/y fields", () => {
    const specRaw = loadJson("component_spec.line.json");
    const expected = loadJson("dataset.line.json");
    const parsed = parseComponentSpec(specRaw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const rows = [
      { month: "2026-01", count: 1200 },
      { month: "2026-02", count: 1850 },
      { month: "2026-03", count: 2100 },
    ];
    const schema = [
      { name: "month", type: "string" },
      { name: "count", type: "number" },
    ];

    const dataset = formatData(parsed.data, rows, schema, { rowCount: rows.length });

    expect(dataset).toEqual(expected);
    const validated = parseDataset("line", dataset);
    expect(validated.success).toBe(true);
  });

  it("formats row dataset from y/x fields", () => {
    const specRaw = loadJson("component_spec.row.json");
    const expected = loadJson("dataset.row.json");
    const parsed = parseComponentSpec(specRaw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const rows = [
      { product_name: "Bucket", total: 1200 },
      { product_name: "Pizza", total: 45000 },
      { product_name: "Chef Special", total: 89000 },
    ];
    const schema = [
      { name: "product_name", type: "string" },
      { name: "total", type: "number" },
    ];

    const dataset = formatData(parsed.data, rows, schema, { rowCount: rows.length });

    expect(dataset).toEqual(expected);
    const validated = parseDataset("row", dataset);
    expect(validated.success).toBe(true);
  });

  it("formats row chart for top products AI example", () => {
    const spec = {
      type: "row",
      title: "Top 5 Products",
      data_map: { y_field: "product_name", x_field: "quantity_sold" },
      config: {
        display: {
          series: [{ key: "quantity_sold", label: "Quantity Sold", axis: "auto" }],
        },
      },
    };

    const rows = [
      { product_name: "Widget A", quantity_sold: 120 },
      { product_name: "Widget B", quantity_sold: 95 },
      { product_name: "Widget C", quantity_sold: 80 },
    ];
    const schema = [
      { name: "product_name", type: "string" },
      { name: "quantity_sold", type: "number" },
    ];

    const dataset = formatData(spec, rows, schema, { rowCount: rows.length });

    expect(dataset).toEqual({
      categories: ["Widget A", "Widget B", "Widget C"],
      series: [{ name: "Quantity Sold", data: [120, 95, 80] }],
    });
  });

  it("infers measure and series fields when line data_map is wrong", () => {
    const spec = {
      type: "line",
      title: "Monthly payment trend",
      data_map: {
        x_field: "month",
        y_field: "payment_method_id",
        series_field: null,
      },
      config: {
        display: {
          series: [{ key: "total_payment", label: "Total Payment", axis: "auto" }],
        },
      },
    };

    const rows = [
      { payment_method_id: 1, month: "2026-01", total_payment: 1000 },
      { payment_method_id: 2, month: "2026-01", total_payment: 500 },
      { payment_method_id: 1, month: "2026-02", total_payment: 1200 },
      { payment_method_id: 2, month: "2026-02", total_payment: 600 },
    ];
    const schema = [
      { name: "payment_method_id", type: "number" },
      { name: "month", type: "string" },
      { name: "total_payment", type: "number" },
    ];

    const dataset = formatData(spec, rows, schema, { rowCount: rows.length });

    expect(dataset.categories).toEqual(["2026-01", "2026-02"]);
    expect(dataset.series).toHaveLength(2);
    expect(dataset.series).toEqual(
      expect.arrayContaining([
        { name: "Method 1", data: [1000, 1200] },
        { name: "Method 2", data: [500, 600] },
      ]),
    );
    const validated = parseDataset("line", dataset);
    expect(validated.success).toBe(true);
  });

  it("formats multi-series line dataset when data_map is correct", () => {
    const spec = {
      type: "line",
      data_map: {
        x_field: "month",
        y_field: "total_payment",
        series_field: "payment_method_id",
      },
      config: {
        display: {
          series: [
            { key: "1", label: "Card" },
            { key: "2", label: "Cash" },
          ],
        },
      },
    };

    const rows = [
      { payment_method_id: 1, month: "2026-01", total_payment: 1000 },
      { payment_method_id: 2, month: "2026-01", total_payment: 500 },
      { payment_method_id: 1, month: "2026-02", total_payment: 1200 },
      { payment_method_id: 2, month: "2026-02", total_payment: 600 },
    ];
    const schema = [
      { name: "payment_method_id", type: "number" },
      { name: "month", type: "string" },
      { name: "total_payment", type: "number" },
    ];

    const dataset = formatData(spec, rows, schema, { rowCount: rows.length });

    expect(dataset.categories).toEqual(["2026-01", "2026-02"]);
    expect(dataset.series).toEqual(
      expect.arrayContaining([
        { name: "Card", data: [1000, 1200] },
        { name: "Cash", data: [500, 600] },
      ]),
    );
  });

  it("sums duplicate categories for single-series charts", () => {
    const spec = {
      type: "bar",
      data_map: { x_field: "source", y_field: "count", series_field: null },
      config: {
        display: {
          series: [{ key: "count", label: "Count" }],
        },
      },
    };

    const rows = [
      { source: "Google", count: 10 },
      { source: "Google", count: 5 },
      { source: "Facebook", count: 7 },
    ];
    const schema = [
      { name: "source", type: "string" },
      { name: "count", type: "number" },
    ];

    const dataset = formatData(spec, rows, schema, { rowCount: rows.length });

    expect(dataset).toEqual({
      categories: ["Google", "Facebook"],
      series: [{ name: "Count", data: [15, 7] }],
    });
  });

  it("formats monthly payment trend with payment methods as series lines", () => {
    const spec = {
      type: "line",
      data_map: {
        x_field: "month",
        y_field: "payment_method_id",
        series_field: null,
      },
      config: {
        display: {
          series: [{ key: "payment_method_id", label: "Payment Method Id" }],
        },
      },
    };

    const rows = [
      { month: "2025-07", payment_method_id: 1, total_payment: 1103.3 },
      { month: "2025-07", payment_method_id: 9, total_payment: 169235.83 },
      { month: "2025-08", payment_method_id: 1, total_payment: 32871.85 },
      { month: "2025-09", payment_method_id: 2, total_payment: 2668.19 },
      { month: "2025-11", payment_method_id: 1, total_payment: 42038.71 },
      { month: "2025-11", payment_method_id: 9, total_payment: 1074849.93 },
      { month: "2025-12", payment_method_id: 1, total_payment: 9745.38 },
    ];
    const schema = [
      { name: "month", type: "string" },
      { name: "payment_method_id", type: "number" },
      { name: "total_payment", type: "decimal" },
    ];

    const dataset = formatData(spec, rows, schema, { rowCount: rows.length });

    expect(dataset.categories).toEqual([
      "2025-07",
      "2025-08",
      "2025-09",
      "2025-11",
      "2025-12",
    ]);
    expect(dataset.series.length).toBeLessThanOrEqual(4);
    expect(dataset.series[0]).toEqual(
      expect.objectContaining({
        name: "Method 1",
        data: expect.arrayContaining([1103.3, 32871.85, 42038.71, 9745.38]),
      }),
    );
    expect(dataset.series).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Method 9",
          data: expect.arrayContaining([169235.83, 1074849.93]),
        }),
      ]),
    );
    expect(
      dataset.series.every((series) =>
        series.data.every((value) => value === null || typeof value === "number"),
      ),
    ).toBe(true);
  });

  it("corrects inverted measure and series fields for line charts", () => {
    const spec = {
      type: "line",
      data_map: {
        x_field: "month",
        y_field: "payment_method_id",
        series_field: "total_payment",
      },
      config: {
        display: {
          series: [{ key: "payment_method_id", label: "Payment Method Id" }],
        },
      },
    };

    const rows = [
      { month: "2025-07", payment_method_id: 1, total_payment: 1103.3 },
      { month: "2025-07", payment_method_id: 9, total_payment: 169235.83 },
      { month: "2025-08", payment_method_id: 1, total_payment: 32871.85 },
    ];
    const schema = [
      { name: "month", type: "string" },
      { name: "payment_method_id", type: "number" },
      { name: "total_payment", type: "decimal" },
    ];

    const dataset = formatData(spec, rows, schema, { rowCount: rows.length });

    expect(dataset.series).toEqual([
      { name: "Method 1", data: [1103.3, 32871.85] },
      { name: "Method 9", data: [169235.83, null] },
    ]);
  });

  it("formats row chart when category ids are bigint", () => {
    const spec = {
      type: "row",
      data_map: { y_field: "product_id", x_field: "total_quantity_sold" },
      config: {
        display: {
          series: [{ key: "total_quantity_sold", label: "Quantity Sold", axis: "auto" }],
        },
      },
    };

    const rows = [
      { product_id: 101n, total_quantity_sold: 500 },
      { product_id: 102n, total_quantity_sold: 400 },
    ];
    const schema = [
      { name: "product_id", type: "bigint" },
      { name: "total_quantity_sold", type: "number" },
    ];

    const dataset = formatData(spec, rows, schema, { rowCount: rows.length });

    expect(dataset).toEqual({
      categories: [101, 102],
      series: [{ name: "Quantity Sold", data: [500, 400] }],
    });
    const validated = parseDataset("row", dataset);
    expect(validated.success).toBe(true);
  });

  it("falls back to available id column when row y_field name mismatches sql alias", () => {
    const spec = {
      type: "row",
      data_map: { y_field: "product_name", x_field: "total_quantity_sold" },
      config: {
        display: {
          series: [{ key: "total_quantity_sold", label: "Quantity Sold", axis: "auto" }],
        },
      },
    };

    const rows = [
      { product_id: 101, total_quantity_sold: 500 },
      { product_id: 102, total_quantity_sold: 400 },
    ];
    const schema = [
      { name: "product_id", type: "number" },
      { name: "total_quantity_sold", type: "number" },
    ];

    const dataset = formatData(spec, rows, schema, { rowCount: rows.length });

    expect(dataset).toEqual({
      categories: [101, 102],
      series: [{ name: "Quantity Sold", data: [500, 400] }],
    });
  });

  it("throws for unsupported component type", () => {
    const spec = {
      type: "pie",
      data_map: { label_field: "label", value_field: "value" },
      config: {},
    };

    expect(() => formatData(spec, [], [], {})).toThrow(
      "Unsupported component type: pie",
    );
  });
});

