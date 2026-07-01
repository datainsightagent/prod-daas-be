import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  prisma: {
    entityDescription: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../src/lib/prisma.js", () => ({
  prisma: mocked.prisma,
}));

import { listEntityDescriptions } from "../src/services/entities.service.js";

describe("entities.service PRD-05 Phase A", () => {
  const auth = { tenantId: "tenantA", role: "tenant_admin" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists entity descriptions for tenant ordered by updatedAt desc", async () => {
    mocked.prisma.entityDescription.findMany.mockResolvedValue([
      {
        entityId: "e1",
        tenantId: "tenantA",
        entityType: "table",
        entityName: "orders",
        description: "Purchase orders",
        source: "agent",
        confidence: 0.9,
        metadata: null,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-08T00:00:00.000Z"),
      },
    ]);

    const rows = await listEntityDescriptions({ auth });

    expect(mocked.prisma.entityDescription.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenantA" },
      orderBy: [{ updatedAt: "desc" }],
    });
    expect(rows).toEqual([
      {
        entity_id: "e1",
        tenant_id: "tenantA",
        entity_type: "table",
        entity_name: "orders",
        description: "Purchase orders",
        source: "agent",
        confidence: 0.9,
        metadata: null,
        created_at: new Date("2026-05-01T00:00:00.000Z"),
        updated_at: new Date("2026-05-08T00:00:00.000Z"),
      },
    ]);
  });
});
