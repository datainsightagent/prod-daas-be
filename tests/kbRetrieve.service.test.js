import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  assertRequiredRole: vi.fn(),
  kbRetrieveViaAi: vi.fn(),
}));

vi.mock("../src/services/auth.service.js", () => ({
  assertRequiredRole: mocked.assertRequiredRole,
}));

vi.mock("../src/services/kbAi.client.js", () => ({
  kbRetrieveViaAi: mocked.kbRetrieveViaAi,
}));

import { kbRetrieve } from "../src/services/kbRetrieve.service.js";

describe("kbRetrieve.service", () => {
  const auth = { tenantId: "tenantA", role: "tenant_admin" };

  beforeEach(() => {
    vi.clearAllMocks();
    mocked.assertRequiredRole.mockImplementation(() => {});
    mocked.kbRetrieveViaAi.mockResolvedValue({
      items: [
        {
          text: "hello",
          metadata: { k: 1 },
          score: 0.9,
          type: "glossary",
        },
      ],
    });
  });

  it("proxies retrieve to daas-ai", async () => {
    const out = await kbRetrieve({
      auth,
      body: { query: "status values", limit: 3, types: ["glossary"] },
    });
    expect(mocked.kbRetrieveViaAi).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenantA",
        query: "status values",
        limit: 3,
        types: ["glossary"],
      }),
    );
    expect(out.items[0]).toMatchObject({
      text: "hello",
      score: 0.9,
      type: "glossary",
      metadata: { k: 1 },
    });
  });

  it("passes min_similarity to daas-ai", async () => {
    await kbRetrieve({
      auth,
      body: { query: "q", min_similarity: 0.3 },
    });
    expect(mocked.kbRetrieveViaAi).toHaveBeenCalledWith(
      expect.objectContaining({
        min_similarity: 0.3,
      }),
    );
  });
});
