/**
 * Verifies VECTOR_DATABASE_URL from .env (same mechanism as the API via dotenv).
 * Run from daas-backend: npm run check:vector-db
 */
import "dotenv/config";
import pg from "pg";

const url = process.env.VECTOR_DATABASE_URL?.trim();
if (!url) {
  console.error(
    "Missing VECTOR_DATABASE_URL. Add it to daas-backend/.env (password: encode ! as %21 in the URL).",
  );
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  connectionTimeoutMillis: 5000,
});

try {
  await client.connect();
  const ping = await client.query("SELECT current_database() AS db, current_user AS role");
  console.log("Connected:", ping.rows[0]);

  const ext = await client.query(
    "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'",
  );
  if (ext.rows.length === 0) {
    console.warn(
      "Extension 'vector' is not installed in this database. Run: CREATE EXTENSION vector;",
    );
    process.exitCode = 1;
  } else {
    console.log("pgvector:", ext.rows[0]);
  }
} catch (err) {
  console.error("Connection failed:", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
