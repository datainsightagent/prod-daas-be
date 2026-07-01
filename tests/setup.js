/**
 * Unit tests mock partial Prisma clients; tenant routing must stay off so
 * domain services use the mocked central client (see tenantPrismaRouting.js).
 */
process.env.TENANT_DB_READ_WRITE_ENABLED = "false";
