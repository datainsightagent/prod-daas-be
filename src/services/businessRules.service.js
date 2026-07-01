import { logger } from "../lib/logger.js";
import { assertRequiredRole } from "./auth.service.js";
import { resolveDomainPrismaForAuth } from "../lib/tenantPrismaRouting.js";
import { kbIndexViaAi } from "./kbAi.client.js";

const MAX_NAME_LENGTH = 191;
const MAX_DESCRIPTION_LENGTH = 2000;
/** MySQL TEXT upper bound (bytes); keep a safe character cap for validation */
const MAX_EXPRESSION_LENGTH = 60000;

export class BusinessRulesServiceError extends Error {
  constructor(message, statusCode, errorCode) {
    super(message);
    this.name = "BusinessRulesServiceError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

function normalizeName(name) {
  return String(name || "").trim();
}

function normalizeOptionalSource(source) {
  const value = String(source || "").trim().toLowerCase();
  if (!value) {
    return undefined;
  }
  if (!["user", "agent", "user_onboarding"].includes(value)) {
    throw new BusinessRulesServiceError(
      "source must be one of: user, agent, user_onboarding",
      422,
      "validation_error",
    );
  }
  return value;
}

function parseConfidence(input) {
  if (input === undefined || input === null || input === "") {
    return undefined;
  }
  const value = Number(input);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new BusinessRulesServiceError(
      "confidence must be a number between 0 and 1",
      422,
      "validation_error",
    );
  }
  return value;
}

function assertBusinessRuleCreateInput({ name, expression, description }) {
  if (!name || !normalizeName(name)) {
    throw new BusinessRulesServiceError("name is required", 422, "validation_error");
  }
  const n = normalizeName(name);
  if (n.length > MAX_NAME_LENGTH) {
    throw new BusinessRulesServiceError(
      `name must be at most ${MAX_NAME_LENGTH} characters`,
      422,
      "validation_error",
    );
  }

  const expr = String(expression ?? "").trim();
  if (!expr) {
    throw new BusinessRulesServiceError("expression is required", 422, "validation_error");
  }
  if (expr.length > MAX_EXPRESSION_LENGTH) {
    throw new BusinessRulesServiceError(
      `expression must be at most ${MAX_EXPRESSION_LENGTH} characters`,
      422,
      "validation_error",
    );
  }

  if (description !== undefined && description !== null) {
    const d = String(description).trim();
    if (d.length > MAX_DESCRIPTION_LENGTH) {
      throw new BusinessRulesServiceError(
        `description must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
        422,
        "validation_error",
      );
    }
  }
}

function mapBusinessRuleRow(row) {
  return {
    rule_id: row.ruleId,
    tenant_id: row.tenantId,
    name: row.name,
    expression: row.expression,
    description: row.description,
    source: row.source,
    confidence: Number(row.confidence),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
  };
}

async function getBusinessRuleByIdOrFail({ tenantId, ruleId, includeDeleted = false, db }) {
  const row = await db.businessRule.findFirst({
    where: {
      ruleId,
      tenantId,
      ...(includeDeleted ? {} : { deletedAt: null }),
    },
  });

  if (!row) {
    throw new BusinessRulesServiceError("Business rule not found", 404, "not_found");
  }
  return row;
}

async function onAfterBusinessRuleWrite(event) {
  try {
    await kbIndexViaAi({
      tenantId: event.tenantId,
      collection: "business_rule",
      action: event.action === "deleted" ? "delete" : "upsert",
      sourceId: event.ruleId,
      name: event.name,
      expression: event.expression,
      description: event.description ?? null,
    });
  } catch (err) {
    logger.error({
      event: "business_rule.vector_sync_failed",
      tenantId: event.tenantId,
      ruleId: event.ruleId,
      action: event.action,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function createBusinessRule({ auth, input }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  assertBusinessRuleCreateInput(input || {});
  const domainPrisma = await resolveDomainPrismaForAuth(auth);

  const name = normalizeName(input.name);
  const expression = String(input.expression).trim();
  const description =
    input.description === undefined || input.description === null
      ? null
      : String(input.description).trim() || null;
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    throw new BusinessRulesServiceError(
      `description must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
      422,
      "validation_error",
    );
  }

  const source = normalizeOptionalSource(input.source) || "user";
  const confidence = parseConfidence(input.confidence) ?? 1;

  let created;
  try {
    created = await domainPrisma.businessRule.create({
      data: {
        tenantId: auth.tenantId,
        name,
        expression,
        description,
        source,
        confidence,
      },
    });
  } catch (error) {
    if (String(error?.code || "") === "P2002") {
      throw new BusinessRulesServiceError(
        "Business rule name already exists for this tenant",
        409,
        "already_exists",
      );
    }
    throw error;
  }

  await onAfterBusinessRuleWrite({
    action: "created",
    ruleId: created.ruleId,
    tenantId: created.tenantId,
    name: created.name,
    expression: created.expression,
    description: created.description,
  });

  return mapBusinessRuleRow(created);
}

export async function listBusinessRules({ auth }) {
  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const rows = await domainPrisma.businessRule.findMany({
    where: {
      tenantId: auth.tenantId,
      deletedAt: null,
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  return rows.map(mapBusinessRuleRow);
}

export async function getBusinessRuleById({ auth, ruleId }) {
  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const row = await getBusinessRuleByIdOrFail({
    tenantId: auth.tenantId,
    ruleId,
    db: domainPrisma,
  });

  return mapBusinessRuleRow(row);
}

export async function updateBusinessRule({ auth, ruleId, input }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const row = await getBusinessRuleByIdOrFail({
    tenantId: auth.tenantId,
    ruleId,
    db: domainPrisma,
  });

  const hasName = Object.prototype.hasOwnProperty.call(input || {}, "name");
  const hasExpression = Object.prototype.hasOwnProperty.call(input || {}, "expression");
  const hasDescription = Object.prototype.hasOwnProperty.call(input || {}, "description");
  const hasSource = Object.prototype.hasOwnProperty.call(input || {}, "source");
  const hasConfidence = Object.prototype.hasOwnProperty.call(input || {}, "confidence");

  if (!hasName && !hasExpression && !hasDescription && !hasSource && !hasConfidence) {
    throw new BusinessRulesServiceError("No fields to update", 422, "validation_error");
  }

  const name = hasName ? normalizeName(input.name) : row.name;
  const expression = hasExpression ? String(input.expression ?? "").trim() : row.expression;
  let description = row.description;
  if (hasDescription) {
    description =
      input.description === undefined || input.description === null
        ? null
        : String(input.description).trim() || null;
  }

  assertBusinessRuleCreateInput({
    name,
    expression,
    description: description ?? undefined,
  });

  const data = {
    name,
    expression,
    description,
  };

  if (hasSource) {
    data.source = normalizeOptionalSource(input.source) || row.source;
  }
  if (hasConfidence) {
    data.confidence = parseConfidence(input.confidence) ?? row.confidence;
  }

  let updated;
  try {
    updated = await domainPrisma.businessRule.update({
      where: { ruleId: row.ruleId },
      data,
    });
  } catch (error) {
    if (String(error?.code || "") === "P2002") {
      throw new BusinessRulesServiceError(
        "Business rule name already exists for this tenant",
        409,
        "already_exists",
      );
    }
    throw error;
  }

  await onAfterBusinessRuleWrite({
    action: "updated",
    ruleId: updated.ruleId,
    tenantId: updated.tenantId,
    name: updated.name,
    expression: updated.expression,
    description: updated.description,
  });

  return mapBusinessRuleRow(updated);
}

export async function deleteBusinessRule({ auth, ruleId }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const row = await getBusinessRuleByIdOrFail({
    tenantId: auth.tenantId,
    ruleId,
    db: domainPrisma,
  });

  await domainPrisma.businessRule.update({
    where: { ruleId: row.ruleId },
    data: { deletedAt: new Date() },
  });

  await onAfterBusinessRuleWrite({
    action: "deleted",
    ruleId: row.ruleId,
    tenantId: row.tenantId,
  });

  return {
    deleted: true,
    rule_id: ruleId,
  };
}
