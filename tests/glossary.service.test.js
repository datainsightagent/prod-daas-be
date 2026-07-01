import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  const prisma = {
    glossaryTerm: {
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
  createGlossaryTerm,
  deleteGlossaryTerm,
  GlossaryServiceError,
  listGlossaryTerms,
  updateGlossaryTerm,
} from "../src/services/glossary.service.js";

describe("glossary.service PRD-05 behaviors", () => {
  const auth = { tenantId: "tenantA", role: "tenant_admin" };

  beforeEach(() => {
    vi.clearAllMocks();
    mocked.assertRequiredRole.mockImplementation(() => {});
  });

  it("creates a glossary term with normalized uniqueness key", async () => {
    mocked.prisma.glossaryTerm.create.mockResolvedValue({
      termId: "term1",
      tenantId: "tenantA",
      term: "Active Student",
      definition: "Student with active enrollment",
      source: "user",
      confidence: 1,
      createdAt: new Date("2026-05-08T00:00:00.000Z"),
      updatedAt: new Date("2026-05-08T00:00:00.000Z"),
      deletedAt: null,
    });

    const output = await createGlossaryTerm({
      auth,
      input: {
        term: " Active Student ",
        definition: "Student with active enrollment",
      },
    });

    expect(mocked.prisma.glossaryTerm.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenantA",
        term: "Active Student",
        termNormalized: "active student",
      }),
    });
    expect(output).toMatchObject({
      term_id: "term1",
      tenant_id: "tenantA",
    });
  });

  it("rejects duplicate glossary term per tenant with 409", async () => {
    const error = new Error("duplicate");
    error.code = "P2002";
    mocked.prisma.glossaryTerm.create.mockRejectedValue(error);

    await expect(
      createGlossaryTerm({
        auth,
        input: {
          term: "Revenue",
          definition: "Total sales",
        },
      }),
    ).rejects.toMatchObject({
      name: "GlossaryServiceError",
      errorCode: "already_exists",
      statusCode: 409,
    });
  });

  it("lists only non-deleted rows for tenant", async () => {
    mocked.prisma.glossaryTerm.findMany.mockResolvedValue([
      {
        termId: "term1",
        tenantId: "tenantA",
        term: "Revenue",
        definition: "Total sales",
        source: "user",
        confidence: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ]);

    const rows = await listGlossaryTerms({ auth });
    expect(mocked.prisma.glossaryTerm.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenantA", deletedAt: null },
      orderBy: [{ updatedAt: "desc" }],
    });
    expect(rows).toHaveLength(1);
  });

  it("updates term and definition with validation", async () => {
    mocked.prisma.glossaryTerm.findFirst.mockResolvedValue({
      termId: "term1",
      tenantId: "tenantA",
      term: "Revenue",
      definition: "Old",
      source: "user",
      confidence: 1,
    });
    mocked.prisma.glossaryTerm.update.mockResolvedValue({
      termId: "term1",
      tenantId: "tenantA",
      term: "Net Revenue",
      definition: "Gross minus refunds",
      source: "user",
      confidence: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });

    const output = await updateGlossaryTerm({
      auth,
      termId: "term1",
      input: {
        term: "Net Revenue",
        definition: "Gross minus refunds",
      },
    });

    expect(mocked.prisma.glossaryTerm.update).toHaveBeenCalledWith({
      where: { termId: "term1" },
      data: expect.objectContaining({
        term: "Net Revenue",
        termNormalized: "net revenue",
      }),
    });
    expect(output.term).toBe("Net Revenue");
  });

  it("soft deletes glossary term", async () => {
    mocked.prisma.glossaryTerm.findFirst.mockResolvedValue({
      termId: "term1",
      tenantId: "tenantA",
      deletedAt: null,
    });
    mocked.prisma.glossaryTerm.update.mockResolvedValue({
      termId: "term1",
      tenantId: "tenantA",
    });

    const output = await deleteGlossaryTerm({
      auth,
      termId: "term1",
    });

    expect(mocked.prisma.glossaryTerm.update).toHaveBeenCalledWith({
      where: { termId: "term1" },
      data: { deletedAt: expect.any(Date) },
    });
    expect(output).toEqual({ deleted: true, term_id: "term1" });
  });

  it("returns not_found when term is outside tenant", async () => {
    mocked.prisma.glossaryTerm.findFirst.mockResolvedValue(null);

    await expect(
      updateGlossaryTerm({
        auth,
        termId: "foreign",
        input: { definition: "x" },
      }),
    ).rejects.toSatisfy(
      (error) =>
        error instanceof GlossaryServiceError &&
        error.errorCode === "not_found" &&
        error.statusCode === 404,
    );
  });
});
