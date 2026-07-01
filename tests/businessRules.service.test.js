import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  const prisma = {
    businessRule: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  };

  return {
    prisma,
    assertRequiredRole: vi.fn(),
  };
});

vi.mock("../src/lib/prisma.js", () => ({
  prisma: mocked.prisma,
}));

vi.mock("../src/services/auth.service.js", () => ({
  assertRequiredRole: mocked.assertRequiredRole,
}));

import {
  BusinessRulesServiceError,
  createBusinessRule,
  deleteBusinessRule,
  listBusinessRules,
  updateBusinessRule,
} from "../src/services/businessRules.service.js";

describe("businessRules.service PRD-05 Phase A", () => {
  const auth = { tenantId: "tenantA", role: "tenant_admin" };

  beforeEach(() => {
    vi.clearAllMocks();
    mocked.assertRequiredRole.mockImplementation(() => {});
  });

  it("creates a business rule with trimmed name and expression", async () => {
    mocked.prisma.businessRule.create.mockResolvedValue({
      ruleId: "rule1",
      tenantId: "tenantA",
      name: "orders_status",
      expression: "orders.status IN ('a','b')",
      description: "Allowed values",
      source: "user",
      confidence: 1,
      createdAt: new Date("2026-05-08T00:00:00.000Z"),
      updatedAt: new Date("2026-05-08T00:00:00.000Z"),
      deletedAt: null,
    });

    const output = await createBusinessRule({
      auth,
      input: {
        name: " orders_status ",
        expression: " orders.status IN ('a','b') ",
        description: "Allowed values",
      },
    });

    expect(mocked.prisma.businessRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenantA",
        name: "orders_status",
        expression: "orders.status IN ('a','b')",
        description: "Allowed values",
      }),
    });
    expect(output).toMatchObject({
      rule_id: "rule1",
      tenant_id: "tenantA",
      name: "orders_status",
    });
  });

  it("rejects duplicate rule name per tenant with 409", async () => {
    const error = new Error("duplicate");
    error.code = "P2002";
    mocked.prisma.businessRule.create.mockRejectedValue(error);

    await expect(
      createBusinessRule({
        auth,
        input: {
          name: "dup",
          expression: "x",
        },
      }),
    ).rejects.toMatchObject({
      name: "BusinessRulesServiceError",
      errorCode: "already_exists",
      statusCode: 409,
    });
  });

  it("lists only non-deleted rules for tenant", async () => {
    mocked.prisma.businessRule.findMany.mockResolvedValue([
      {
        ruleId: "rule1",
        tenantId: "tenantA",
        name: "r1",
        expression: "a=b",
        description: null,
        source: "user",
        confidence: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ]);

    const rows = await listBusinessRules({ auth });
    expect(mocked.prisma.businessRule.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenantA", deletedAt: null },
      orderBy: [{ updatedAt: "desc" }],
    });
    expect(rows).toHaveLength(1);
  });

  it("updates name and expression with validation", async () => {
    mocked.prisma.businessRule.findFirst.mockResolvedValue({
      ruleId: "rule1",
      tenantId: "tenantA",
      name: "old_name",
      expression: "old",
      description: null,
      source: "user",
      confidence: 1,
    });
    mocked.prisma.businessRule.update.mockResolvedValue({
      ruleId: "rule1",
      tenantId: "tenantA",
      name: "new_name",
      expression: "new",
      description: null,
      source: "user",
      confidence: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });

    const output = await updateBusinessRule({
      auth,
      ruleId: "rule1",
      input: {
        name: "new_name",
        expression: "new",
      },
    });

    expect(mocked.prisma.businessRule.update).toHaveBeenCalledWith({
      where: { ruleId: "rule1" },
      data: expect.objectContaining({
        name: "new_name",
        expression: "new",
      }),
    });
    expect(output.name).toBe("new_name");
  });

  it("soft deletes business rule", async () => {
    mocked.prisma.businessRule.findFirst.mockResolvedValue({
      ruleId: "rule1",
      tenantId: "tenantA",
      deletedAt: null,
    });
    mocked.prisma.businessRule.update.mockResolvedValue({
      ruleId: "rule1",
      tenantId: "tenantA",
    });

    const output = await deleteBusinessRule({
      auth,
      ruleId: "rule1",
    });

    expect(mocked.prisma.businessRule.update).toHaveBeenCalledWith({
      where: { ruleId: "rule1" },
      data: { deletedAt: expect.any(Date) },
    });
    expect(output).toEqual({ deleted: true, rule_id: "rule1" });
  });

  it("returns not_found when rule is outside tenant", async () => {
    mocked.prisma.businessRule.findFirst.mockResolvedValue(null);

    await expect(
      updateBusinessRule({
        auth,
        ruleId: "foreign",
        input: { expression: "x" },
      }),
    ).rejects.toSatisfy(
      (error) =>
        error instanceof BusinessRulesServiceError &&
        error.errorCode === "not_found" &&
        error.statusCode === 404,
    );
  });
});
