import { describe, expect, it } from "vitest";
import { computeSchemaDiff } from "../src/services/schemaChangeDiff.service.js";

describe("computeSchemaDiff", () => {
  it("detects table add/remove", () => {
    const previousPayload = {
      tables: [{ table_name: "users", columns: [] }],
    };
    const currentPayload = {
      tables: [{ table_name: "students", columns: [] }],
    };

    const events = computeSchemaDiff(previousPayload, currentPayload);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ changeType: "table_removed", tableName: "users" }),
        expect.objectContaining({ changeType: "table_added", tableName: "students" }),
      ]),
    );
  });

  it("detects column add/remove and type changes", () => {
    const previousPayload = {
      tables: [
        {
          table_name: "users",
          columns: [
            { name: "id", type: "int" },
            { name: "email", type: "varchar" },
          ],
        },
      ],
    };
    const currentPayload = {
      tables: [
        {
          table_name: "users",
          columns: [
            { name: "id", type: "bigint" },
            { name: "student_id", type: "varchar" },
          ],
        },
      ],
    };

    const events = computeSchemaDiff(previousPayload, currentPayload);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          changeType: "column_removed",
          tableName: "users",
          columnName: "email",
        }),
        expect.objectContaining({
          changeType: "column_added",
          tableName: "users",
          columnName: "student_id",
        }),
        expect.objectContaining({
          changeType: "column_type_changed",
          tableName: "users",
          columnName: "id",
          oldValue: { type: "int" },
          newValue: { type: "bigint" },
        }),
      ]),
    );
  });

  it("ignores order-only changes", () => {
    const previousPayload = {
      tables: [
        {
          table_name: "orders",
          columns: [
            { name: "a", type: "int" },
            { name: "b", type: "varchar" },
          ],
        },
        {
          table_name: "users",
          columns: [{ name: "id", type: "int" }],
        },
      ],
    };
    const currentPayload = {
      tables: [
        {
          table_name: "users",
          columns: [{ name: "id", type: "int" }],
        },
        {
          table_name: "orders",
          columns: [
            { name: "b", type: "varchar" },
            { name: "a", type: "int" },
          ],
        },
      ],
    };

    const events = computeSchemaDiff(previousPayload, currentPayload);
    expect(events).toHaveLength(0);
  });
});
