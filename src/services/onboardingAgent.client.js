import { logger } from "../lib/logger.js";

const DEFAULT_ONBOARDING_AI_TIMEOUT_MS = 120000;

function isOnboardingAiServiceEnabled() {
  return String(process.env.ONBOARDING_AI_SERVICE_ENABLED || "false").toLowerCase() === "true";
}

function parseJsonPayload(content) {
  console.log("[parseJsonPayload] input type:", typeof content, "| value:", JSON.stringify(content)?.slice(0, 200));

  if (content && typeof content === "object") {
    return content;
  }
  if (!content || typeof content !== "string") {
    return null;
  }
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch (_innerError) {
        return null;
      }
    }
    return null;
  }
}

async function runExternalOnboardingAgent({
  session,
  snapshotPayload,
  answeredQuestions,
  answers,
  maxTotalQuestions,
}) {
  const baseUrl = String(process.env.DAAS_AI_BASE_URL || "")
    .trim()
    .replace(/\/$/, "");
  const serviceUrl = `${baseUrl}/v1/onboarding/advance`;

  console.log("[onboarding-agent] serviceUrl:", serviceUrl);

  if (!baseUrl) {
    throw new Error("DAAS_AI_BASE_URL is missing");
  }

  const timeoutMs = Number(
    process.env.ONBOARDING_AI_SERVICE_TIMEOUT_MS || DEFAULT_ONBOARDING_AI_TIMEOUT_MS,
  );

  const serviceApiKey = String(
    process.env.DAAS_AI_API_KEY ||
      process.env.ONBOARDING_AI_SERVICE_API_KEY ||
      "",
  ).trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(serviceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(serviceApiKey ? { Authorization: `Bearer ${serviceApiKey}` } : {}),
      },
      signal: controller.signal,
      body: JSON.stringify({
        session: {
          session_id: session.sessionId,
          tenant_id: session.tenantId,
          data_source_id: session.dataSourceId,
          snapshot_id: session.snapshotId,
          round_number: session.roundNumber,
          question_count: session.questionCount,
          max_total_questions: maxTotalQuestions,
        },
        snapshot: snapshotPayload,
        answers,
        answered_questions: answeredQuestions,
      }),
    });

    console.log("[onboarding-agent] AI service HTTP status:", response.status);

    if (!response.ok) {
      const errText = await response.text();
      console.error("[onboarding-agent] AI service error body:", errText);
      throw new Error(`AI service call failed with status ${response.status}: ${errText}`);
    }

    const json = await response.json();
    console.log("[onboarding-agent] raw json keys:", Object.keys(json));
    console.log("[onboarding-agent] json.data type:", typeof json?.data);
    console.log("[onboarding-agent] json.data.status:", json?.data?.status);

    const parsed =
      parseJsonPayload(json?.data) ||
      parseJsonPayload(json?.result) ||
      parseJsonPayload(json?.response) ||
      parseJsonPayload(json);

    console.log("[onboarding-agent] parsed:", parsed ? "OK" : "NULL");
    console.log("[onboarding-agent] parsed.status:", parsed?.status);

    if (!parsed) {
      console.error("[onboarding-agent] FULL json dump:", JSON.stringify(json, null, 2));
      throw new Error("Failed to parse AI service response");
    }
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

export async function runOnboardingAgent(input) {
  if (!isOnboardingAiServiceEnabled()) {
    throw new Error(
      "Onboarding AI service is disabled. Set ONBOARDING_AI_SERVICE_ENABLED=true and start daas-ai.",
    );
  }

  const llmResponse = await runExternalOnboardingAgent(input);
  logger.info({
    event: "onboarding.agent.service.success",
    sessionId: input.session.sessionId,
  });
  return llmResponse;
}
