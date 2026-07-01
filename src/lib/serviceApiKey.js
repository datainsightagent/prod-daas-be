import { timingSafeEqual } from "node:crypto";

import { logger } from "./logger.js";

export function getServiceKeyEntries() {
  const json = String(process.env.AI_SERVICE_API_KEYS_JSON || "").trim();
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return Object.entries(parsed)
          .filter(([, secret]) => typeof secret === "string" && secret.trim())
          .map(([keyId, secret]) => [keyId, String(secret).trim()]);
      }
    } catch (_error) {
      logger.warn({ event: "service_auth.config.invalid_json" });
    }
  }

  const single = String(process.env.AI_SERVICE_API_KEY || "").trim();
  if (!single) {
    return [];
  }
  return [["default", single]];
}

export function resolveServiceKeyId(providedKey, configuredEntries) {
  const provided = Buffer.from(providedKey);
  for (const [keyId, secret] of configuredEntries) {
    const candidate = Buffer.from(secret);
    if (
      candidate.length === provided.length &&
      timingSafeEqual(candidate, provided)
    ) {
      return keyId;
    }
  }
  return null;
}

export function matchesAnyServiceKey(providedKey, configuredEntries) {
  return resolveServiceKeyId(providedKey, configuredEntries) !== null;
}
