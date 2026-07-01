import { logger } from "../lib/logger.js";
import { assertRequiredRole } from "./auth.service.js";
import { resolveDomainPrismaForAuth } from "../lib/tenantPrismaRouting.js";
import { kbIndexViaAi } from "./kbAi.client.js";

const MAX_TERM_LENGTH = 191;
const MAX_DEFINITION_LENGTH = 2000;

export class GlossaryServiceError extends Error {
  constructor(message, statusCode, errorCode) {
    super(message);
    this.name = "GlossaryServiceError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

function normalizeTerm(term) {
  return String(term || "").trim();
}

function normalizeTermForUnique(term) {
  return normalizeTerm(term).toLowerCase();
}

function normalizeOptionalSource(source) {
  const value = String(source || "").trim().toLowerCase();
  if (!value) {
    return undefined;
  }
  if (!["user", "agent", "user_onboarding"].includes(value)) {
    throw new GlossaryServiceError(
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
    throw new GlossaryServiceError(
      "confidence must be a number between 0 and 1",
      422,
      "validation_error",
    );
  }
  return value;
}

function assertGlossaryInput({ term, definition }) {
  if (!term || !normalizeTerm(term)) {
    throw new GlossaryServiceError("term is required", 422, "validation_error");
  }
  if (normalizeTerm(term).length > MAX_TERM_LENGTH) {
    throw new GlossaryServiceError(
      `term must be at most ${MAX_TERM_LENGTH} characters`,
      422,
      "validation_error",
    );
  }

  const normalizedDefinition = String(definition || "").trim();
  if (!normalizedDefinition) {
    throw new GlossaryServiceError("definition is required", 422, "validation_error");
  }
  if (normalizedDefinition.length > MAX_DEFINITION_LENGTH) {
    throw new GlossaryServiceError(
      `definition must be at most ${MAX_DEFINITION_LENGTH} characters`,
      422,
      "validation_error",
    );
  }
}

function mapGlossaryRow(row) {
  return {
    term_id: row.termId,
    tenant_id: row.tenantId,
    term: row.term,
    definition: row.definition,
    source: row.source,
    confidence: Number(row.confidence),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
  };
}

async function getGlossaryByIdOrFail({ tenantId, termId, includeDeleted = false, db }) {
  const row = await db.glossaryTerm.findFirst({
    where: {
      termId,
      tenantId,
      ...(includeDeleted ? {} : { deletedAt: null }),
    },
  });

  if (!row) {
    throw new GlossaryServiceError("Glossary term not found", 404, "not_found");
  }
  return row;
}

async function onAfterGlossaryWrite(event) {
  try {
    await kbIndexViaAi({
      tenantId: event.tenantId,
      collection: "glossary",
      action: event.action === "deleted" ? "delete" : "upsert",
      sourceId: event.termId,
      term: event.term,
      definition: event.definition,
    });
  } catch (err) {
    logger.error({
      event: "glossary.vector_sync_failed",
      tenantId: event.tenantId,
      termId: event.termId,
      action: event.action,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function createGlossaryTerm({ auth, input }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  assertGlossaryInput(input || {});
  const domainPrisma = await resolveDomainPrismaForAuth(auth);

  const term = normalizeTerm(input.term);
  const termNormalized = normalizeTermForUnique(input.term);
  const definition = String(input.definition).trim();
  const source = normalizeOptionalSource(input.source) || "user";
  const confidence = parseConfidence(input.confidence) ?? 1;

  let created;
  try {
    created = await domainPrisma.glossaryTerm.create({
      data: {
        tenantId: auth.tenantId,
        term,
        termNormalized,
        definition,
        source,
        confidence,
      },
    });
  } catch (error) {
    if (String(error?.code || "") === "P2002") {
      throw new GlossaryServiceError(
        "Glossary term already exists for this tenant",
        409,
        "already_exists",
      );
    }
    throw error;
  }

  await onAfterGlossaryWrite({
    action: "created",
    termId: created.termId,
    tenantId: created.tenantId,
    term: created.term,
    definition: created.definition,
  });

  return mapGlossaryRow(created);
}

export async function listGlossaryTerms({ auth }) {
  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const rows = await domainPrisma.glossaryTerm.findMany({
    where: {
      tenantId: auth.tenantId,
      deletedAt: null,
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  return rows.map(mapGlossaryRow);
}

export async function getGlossaryTermById({ auth, termId }) {
  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const row = await getGlossaryByIdOrFail({
    tenantId: auth.tenantId,
    termId,
    db: domainPrisma,
  });

  return mapGlossaryRow(row);
}

export async function updateGlossaryTerm({ auth, termId, input }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const row = await getGlossaryByIdOrFail({
    tenantId: auth.tenantId,
    termId,
    db: domainPrisma,
  });

  const hasTerm = Object.prototype.hasOwnProperty.call(input || {}, "term");
  const hasDefinition = Object.prototype.hasOwnProperty.call(input || {}, "definition");
  const hasSource = Object.prototype.hasOwnProperty.call(input || {}, "source");
  const hasConfidence = Object.prototype.hasOwnProperty.call(input || {}, "confidence");
  if (!hasTerm && !hasDefinition && !hasSource && !hasConfidence) {
    throw new GlossaryServiceError("No fields to update", 422, "validation_error");
  }

  const term = hasTerm ? normalizeTerm(input.term) : row.term;
  const definition = hasDefinition ? String(input.definition || "").trim() : row.definition;
  assertGlossaryInput({ term, definition });

  const data = {
    term,
    termNormalized: normalizeTermForUnique(term),
    definition,
  };

  if (hasSource) {
    data.source = normalizeOptionalSource(input.source) || row.source;
  }
  if (hasConfidence) {
    data.confidence = parseConfidence(input.confidence) ?? row.confidence;
  }

  let updated;
  try {
    updated = await domainPrisma.glossaryTerm.update({
      where: { termId: row.termId },
      data,
    });
  } catch (error) {
    if (String(error?.code || "") === "P2002") {
      throw new GlossaryServiceError(
        "Glossary term already exists for this tenant",
        409,
        "already_exists",
      );
    }
    throw error;
  }

  await onAfterGlossaryWrite({
    action: "updated",
    termId: updated.termId,
    tenantId: updated.tenantId,
    term: updated.term,
    definition: updated.definition,
  });

  return mapGlossaryRow(updated);
}

export async function deleteGlossaryTerm({ auth, termId }) {
  assertRequiredRole(auth, ["tenant_admin"]);
  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const row = await getGlossaryByIdOrFail({
    tenantId: auth.tenantId,
    termId,
    db: domainPrisma,
  });

  const deleted = await domainPrisma.glossaryTerm.update({
    where: { termId: row.termId },
    data: { deletedAt: new Date() },
  });

  await onAfterGlossaryWrite({
    action: "deleted",
    termId: deleted.termId,
    tenantId: deleted.tenantId,
  });

  return {
    deleted: true,
    term_id: termId,
  };
}
