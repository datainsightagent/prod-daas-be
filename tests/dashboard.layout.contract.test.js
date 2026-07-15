import { describe, expect, it } from "vitest";

import { parsePatchDashboardLayoutBody } from "../src/contracts/dashboard.contract.js";

describe("dashboard layout contract", () => {
  it("accepts valid widget layouts within 12 columns", () => {
    const parsed = parsePatchDashboardLayoutBody({
      widgets: [
        { widget_id: "w1", layout: { x: 0, y: 0, w: 6, h: 4 } },
        { widget_id: "w2", layout: { x: 6, y: 0, w: 6, h: 4 } },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects layout that exceeds 12 columns", () => {
    const parsed = parsePatchDashboardLayoutBody({
      widgets: [{ widget_id: "w1", layout: { x: 8, y: 0, w: 6, h: 4 } }],
    });
    expect(parsed.success).toBe(false);
  });

  it("defaults widgets to empty array", () => {
    const parsed = parsePatchDashboardLayoutBody({});
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.widgets).toEqual([]);
  });
});
