import { resolveDomainPrismaForAuth } from "../lib/tenantPrismaRouting.js";

function mapEntityDescriptionRow(row) {
  return {
    entity_id: row.entityId,
    tenant_id: row.tenantId,
    entity_type: row.entityType,
    entity_name: row.entityName,
    description: row.description,
    source: row.source,
    confidence: Number(row.confidence),
    metadata: row.metadata ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

/**
 * Read-only list of entity descriptions for the authenticated tenant (PRD-05 FR-3).
 */
export async function listEntityDescriptions({ auth }) {
  const domainPrisma = await resolveDomainPrismaForAuth(auth);
  const rows = await domainPrisma.entityDescription.findMany({
    where: {
      tenantId: auth.tenantId,
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  return rows.map(mapEntityDescriptionRow);
}
