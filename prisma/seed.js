import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const permissions = [
    "can_manage_data_sources",
    "can_author_dashboards",
    "can_view_dashboards",
  ];

  for (const key of permissions) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key },
    });
  }

  const tenantAdminRole = await prisma.role.upsert({
    where: { name: "tenant_admin" },
    update: {},
    create: { name: "tenant_admin" },
  });

  const analystRole = await prisma.role.upsert({
    where: { name: "analyst" },
    update: {},
    create: { name: "analyst" },
  });

  const allPermissions = await prisma.permission.findMany({
    where: { key: { in: permissions } },
  });
  const permissionByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

  const tenantAdminPermissions = permissions;
  const analystPermissions = ["can_author_dashboards", "can_view_dashboards"];

  await prisma.rolePermissionBridge.createMany({
    data: tenantAdminPermissions.map((key) => ({
      roleId: tenantAdminRole.id,
      permissionId: permissionByKey.get(key),
    })),
    skipDuplicates: true,
  });

  await prisma.rolePermissionBridge.createMany({
    data: analystPermissions.map((key) => ({
      roleId: analystRole.id,
      permissionId: permissionByKey.get(key),
    })),
    skipDuplicates: true,
  });

  const engines = [
    {
      code: "mysql",
      displayName: "MySQL",
      queryType: "sql",
      connectionParamSchema: {
        required: ["host", "port", "database_name", "username", "password"],
        properties: {
          host: { type: "string" },
          port: { type: "number", default: 3306 },
          database_name: { type: "string" },
          username: { type: "string" },
          password: { type: "string", sensitive: true },
        },
      },
    },
    {
      code: "postgres",
      displayName: "PostgreSQL",
      queryType: "sql",
      connectionParamSchema: {
        required: ["host", "port", "database_name", "username", "password"],
        properties: {
          host: { type: "string" },
          port: { type: "number", default: 5432 },
          database_name: { type: "string" },
          username: { type: "string" },
          password: { type: "string", sensitive: true },
        },
      },
    },
    {
      code: "mssql",
      displayName: "Microsoft SQL Server",
      queryType: "sql",
      connectionParamSchema: {
        required: ["host", "port", "database_name", "username", "password"],
        properties: {
          host: { type: "string" },
          port: { type: "number", default: 1433 },
          database_name: { type: "string" },
          username: { type: "string" },
          password: { type: "string", sensitive: true },
        },
      },
    },
    {
      code: "sqlite",
      displayName: "SQLite",
      queryType: "sql",
      connectionParamSchema: {
        required: ["file_path"],
        properties: {
          file_path: { type: "string" },
        },
      },
    },
    {
      code: "bigquery",
      displayName: "Google BigQuery",
      queryType: "sql",
      connectionParamSchema: {
        required: ["project_id", "dataset", "service_account_json"],
        properties: {
          project_id: { type: "string" },
          dataset: { type: "string" },
          service_account_json: { type: "string", sensitive: true },
        },
      },
    },
    {
      code: "snowflake",
      displayName: "Snowflake",
      queryType: "sql",
      connectionParamSchema: {
        required: ["account", "warehouse", "database_name", "username", "password"],
        properties: {
          account: { type: "string" },
          warehouse: { type: "string" },
          database_name: { type: "string" },
          username: { type: "string" },
          password: { type: "string", sensitive: true },
        },
      },
    },
  ];

  for (const engine of engines) {
    await prisma.dbEngine.upsert({
      where: { code: engine.code },
      update: {
        displayName: engine.displayName,
        queryType: engine.queryType,
        connectionParamSchema: engine.connectionParamSchema,
      },
      create: engine,
    });
  }

  console.log("Seed complete: roles, permissions, and DB engines are ready.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
