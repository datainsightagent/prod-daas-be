import { describe, expect, it } from "vitest";

import {
  getServiceKeyEntries,
  matchesAnyServiceKey,
  resolveServiceKeyId,
} from "../src/lib/serviceApiKey.js";

describe("serviceApiKey", () => {
  it("reads AI_SERVICE_API_KEY", () => {
    process.env.AI_SERVICE_API_KEY = "secret-a";
    delete process.env.AI_SERVICE_API_KEYS_JSON;

    const entries = getServiceKeyEntries();
    expect(entries).toEqual([["default", "secret-a"]]);
    expect(resolveServiceKeyId("secret-a", entries)).toBe("default");
    expect(matchesAnyServiceKey("secret-a", entries)).toBe(true);
    expect(matchesAnyServiceKey("wrong", entries)).toBe(false);
  });
});
