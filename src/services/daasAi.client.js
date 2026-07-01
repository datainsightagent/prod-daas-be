import { logger } from "../lib/logger.js";

const DEFAULT_TIMEOUT_MS = 30000;

function baseUrl() {
  const explicit = String(process.env.DAAS_AI_BASE_URL || "").trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  return "http://127.0.0.1:8100";
}

function apiKey() {
  return String(process.env.DAAS_AI_API_KEY || process.env.ONBOARDING_AI_SERVICE_API_KEY || "").trim();
}

function timeoutMs(override) {
  const raw = override ?? process.env.DAAS_AI_TIMEOUT_MS ?? process.env.ONBOARDING_AI_SERVICE_TIMEOUT_MS;
  const n = Number(raw || DEFAULT_TIMEOUT_MS);
  return Math.min(Math.max(n, 1000), 300_000);
}

/**
 * @param {string} path - e.g. /v1/kb/retrieve
 * @param {{ method?: string; body?: object; tenantId: string; timeoutMs?: number }} opts
 */
export async function callDaasAi(path, { method = "POST", body, tenantId, timeoutMs: tmo } = {}) {
  const url = `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(tmo));
  const key = apiKey();

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Id": tenantId,
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      signal: controller.signal,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`daas-ai ${path} failed: HTTP ${response.status} ${errText.slice(0, 200)}`);
    }

    const json = await response.json();
    return json?.data ?? json;
  } catch (err) {
    logger.warn({
      event: "daas_ai.client.error",
      path,
      tenantId,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function isDaasAiKbEnabled() {
  return String(process.env.DAAS_AI_KB_ENABLED || "true").toLowerCase() !== "false";
}

/** Path 2 — start Text2Component query session on daas-ai. */
export function startText2ComponentQuery(payload, tenantId) {
  return callDaasAi("/v1/query", { body: payload, tenantId });
}

/** Resume Text2Component session after clarification answers. */
export function resumeText2ComponentQuery(payload, tenantId) {
  return callDaasAi("/v1/query/resume", { body: payload, tenantId });
}
