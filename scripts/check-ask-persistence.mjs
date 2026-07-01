/**
 * Read-only check: verify ask chat persistence in tenant DB.
 * Usage: node scripts/check-ask-persistence.mjs [tenant-db-name]
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const dbName = process.argv[2] || "daas_tenant_di";
const baseUrl = process.env.TENANT_DB_BASE_URL || process.env.DATABASE_URL;
if (!baseUrl) {
  console.error("TENANT_DB_BASE_URL or DATABASE_URL required");
  process.exit(1);
}

const parsed = new URL(baseUrl);
parsed.pathname = `/${encodeURIComponent(dbName)}`;
const url = parsed.toString();

const conn = await mysql.createConnection(url);

const [sessions] = await conn.query(
  `SELECT session_id, question, title, status, created_at, updated_at
   FROM ask_sessions ORDER BY updated_at DESC LIMIT 5`,
);

console.log("\n=== ask_sessions (latest 5) ===");
console.table(sessions);

const [messages] = await conn.query(
  `SELECT message_id, session_id, type,
          LEFT(content, 80) AS content_preview,
          sequence_order, parent_message_id, created_at
   FROM messages
   ORDER BY session_id, sequence_order
   LIMIT 20`,
);

console.log("\n=== messages ===");
console.table(messages);

const [logs] = await conn.query(
  `SELECT log_id, session_id, message_id, step, level,
          LEFT(message, 60) AS log_preview, sequence_order
   FROM generation_logs
   ORDER BY session_id, sequence_order
   LIMIT 20`,
);

console.log("\n=== generation_logs ===");
console.table(logs);

const [health] = await conn.query(
  `SELECT s.session_id, s.status, LEFT(s.title, 40) AS title,
          SUM(CASE WHEN m.type = 'user' THEN 1 ELSE 0 END) AS user_msgs,
          SUM(CASE WHEN m.type = 'assistant' THEN 1 ELSE 0 END) AS assistant_msgs,
          COUNT(DISTINCT g.log_id) AS log_count
   FROM ask_sessions s
   LEFT JOIN messages m ON m.session_id = s.session_id
   LEFT JOIN generation_logs g ON g.session_id = s.session_id
   GROUP BY s.session_id, s.status, s.title
   ORDER BY MAX(s.updated_at) DESC
   LIMIT 10`,
);

console.log("\n=== health check ===");
console.table(health);

await conn.end();
