import WebSocket from "ws";
import { logger } from "../lib/logger.js";

export function getDaasAiWsBaseUrl() {
  const explicit = String(process.env.DAAS_AI_BASE_URL || "").trim();
  if (explicit) {
    return explicit.replace(/\/$/, "").replace(/^http/i, "ws");
  }
  return "ws://127.0.0.1:8100";
}

export function getDaasAiApiKey() {
  return String(
    process.env.DAAS_AI_API_KEY ||
      process.env.ONBOARDING_AI_SERVICE_API_KEY ||
      "",
  ).trim();
}

/**
 * Opens upstream AI WebSocket (with Bearer when configured) and relays
 * each message to the HTTP response as Server-Sent Events.
 */
export function relayWebSocketToSse(res, wsUrl) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  const apiKey = getDaasAiApiKey();
  const ws = new WebSocket(wsUrl, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });

  let closed = false;

  const finish = () => {
    if (closed) return;
    closed = true;
    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    } catch {
      // ignore close errors
    }
    if (!res.writableEnded) {
      res.end();
    }
  };

  ws.on("open", () => {
    res.write(": relay-connected\n\n");
  });

  ws.on("message", (data) => {
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    const payload = text.replace(/\r?\n/g, "\\n");
    res.write(`data: ${payload}\n\n`);
  });

  ws.on("error", (err) => {
    logger.warn({
      event: "ai_stream_relay.error",
      wsUrl,
      message: err instanceof Error ? err.message : String(err),
    });
    const failure = JSON.stringify({
      type: "failed",
      code: "stream_relay_error",
      message: "Failed to connect to AI stream",
    });
    res.write(`data: ${failure}\n\n`);
    finish();
  });

  ws.on("close", () => {
    finish();
  });

  res.on("close", () => {
    finish();
  });
}

export function buildAskRelayWebSocketUrl(streamUrl, streamToken) {
  const base = getDaasAiWsBaseUrl();
  const path = streamUrl.startsWith("/") ? streamUrl : `/${streamUrl}`;
  const url = new URL(`${base}${path}`);
  url.searchParams.set("token", streamToken);
  return url.toString();
}

export function buildOnboardingRelayWebSocketUrl(sessionId) {
  const base = getDaasAiWsBaseUrl();
  return `${base}/v1/onboarding/${encodeURIComponent(sessionId)}/stream`;
}
