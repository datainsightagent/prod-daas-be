import { describe, expect, it } from "vitest";
import {
  normalizeSampleRowLimit,
  SchemaSnapshotContractError,
  validateSchemaSnapshotPayload,
} from "../src/contracts/schemaSnapshot.contract.js";

describe("schema snapshot contract", () => {
  it("accepts valid payload shape", () => {
    const payload = {
      tables: [
        {
          table_name: "customers",
          row_estimate: 10,
          columns: [
            {
              name: "id",
              type: "int",
              nullable: false,
              is_primary_key: true,
            },
          ],
          primary_key: ["id"],
          foreign_keys: [],
          sample_rows: [{ id: 1 }],
        },
      ],
    };

    expect(validateSchemaSnapshotPayload(payload)).toEqual(payload);
  });

  it("rejects invalid payload shape", () => {
    expect(() =>
      validateSchemaSnapshotPayload({
        tables: [{ table_name: "customers" }],
      }),
    ).toThrow(SchemaSnapshotContractError);
  });

  it("normalizes sample_rows_per_table default", () => {
    expect(normalizeSampleRowLimit(undefined)).toBe(3);
  });

  it("rejects sample_rows_per_table above max", () => {
    expect(() => normalizeSampleRowLimit(11)).toThrow(SchemaSnapshotContractError);
  });
});
