# PRD-05 — Vector database (pgvector): how it works, how data gets in, how to search

This guide is for engineers and operators. It complements [KB_RETRIEVE_CONTRACT.md](./KB_RETRIEVE_CONTRACT.md) (API request/response details for `POST /v1/kb/retrieve`).

---

## 1. Two databases, two jobs

| Store | Technology | Holds |
|-------|------------|--------|
| **Main app data** | MySQL (Prisma) | Users, tenants, glossary rows, business rules, entities, onboarding sessions, data sources, schema snapshots, etc. |
| **Knowledge search** | Postgres + **pgvector** (`VECTOR_DATABASE_URL`) | **Searchable text chunks** + **embedding vectors** for the knowledge base only. Not a copy of all MySQL tables. |

The backend is the only component that should write to the vector database in normal operation.

---

## 2. Tenant layout in Postgres

For each tenant (same id as JWT `tenant_id` / Prisma `Tenant.id`):

- **Schema name:** `tenant_<tenantId>` (example: `tenant_cmp2hemxp00007h64udef5201`).
- **Table:** `embeddings` inside that schema.
- **Lifecycle:** The schema and table are created **lazily** on the first vector write or search for that tenant (no separate “provision vector tenant” step).

**Isolation:** Every read and write runs only inside that tenant’s schema. Clients never choose the schema name; the server derives it from the authenticated user.

---

## 3. How a row in `embeddings` looks (conceptually)

Each row is one **searchable chunk**:

| Column | Purpose |
|--------|---------|
| `id` | Stable id for upserts (e.g. `glossary:<termId>`, `schema_summary:<snapshotId>`). |
| `collection_type` | `business_context`, `entity_definitions`, `business_rules_enums`, `clarification_qa_pairs`, `schema_summary`, `assumptions`, `glossary`, `business_rule` |
| `text` | Human-readable chunk returned to callers and used for embedding. |
| `embedding` | `vector(n)` — numeric representation of `text` for similarity search. |
| `metadata` | JSON (e.g. `tenant_id`, `term_id`, `session_id`, `snapshot_id`). |
| `text_hash` | Optional hash for idempotency. |
| `created_at` / `updated_at` | Timestamps. |

**Important:** `KB_EMBEDDING_DIMENSION` (and the pgvector column size) must match the length of vectors produced by the embedder (see section 6).

---

## 4. How data gets into the vector DB (you do not “send vectors” from Postman)

**Callers send normal JSON to existing REST APIs.** The server builds text, calls the embedder, and upserts into Postgres.

```mermaid
flowchart LR
  Client[Client_or_agent]
  API[daas_backend_REST]
  MySQL[(MySQL)]
  Embed[embedder_client]
  PG[(Postgres_pgvector)]

  Client -->|"JSON_text_only"| API
  API --> MySQL
  API --> Embed
  Embed -->|"embedding_vector"| API
  API --> PG
```

### 4.1 Glossary

- **Write path:** `POST /v1/glossary`, `PATCH /v1/glossary/:id`, soft `DELETE /v1/glossary/:id`.
- After a successful write, the service syncs a chunk like “Glossary term: … / Definition: …” into `collection_type = glossary` (delete removes the vector row for that term).

### 4.2 Business rules

- **Write path:** `POST /v1/business-rules`, `PATCH`, soft `DELETE`.
- Syncs name + expression (+ description) into `collection_type = business_rule`.

### 4.3 Onboarding completion

- When onboarding reaches **success**, after the MySQL transaction `onboardingVectorSync.js` upserts:
  - **All** session Q&A (full history) → `clarification_qa_pairs`
  - assumptions → `assumptions`
  - snapshot digest → `schema_summary`
  - Round 1 profile + glossary → `business_context`
  - Round 2 entity descriptions → `entity_definitions`
  - Round 3–4 rules + enums → `business_rules_enums`
  - Each glossary term / business rule → `glossary` / `business_rule` (mirrors MySQL rows)
- The `advance` success payload includes **`vector_sync`**: `{ status, message, collections }`  
  - `status: "skipped"` when `ONBOARDING_VECTORSTORE_ADAPTER=noop`  
  - `status: "ok"` when pgvector writes succeed

There is **no** public “upload arbitrary vector” endpoint by design (tenant safety and consistency).

---

## 5. How search works

**Endpoint:** `POST /v1/kb/retrieve` (requires JWT, `tenant_admin` in V1).

**Flow:**

1. Client sends `{ "query": "...", "limit": 10, "types": ["glossary"], "min_similarity": 0.25 }` (see [KB_RETRIEVE_CONTRACT.md](./KB_RETRIEVE_CONTRACT.md)); **`min_similarity`** is optional and matches the PRD-04 notebook threshold (drop weak matches before applying `limit`).
2. Server embeds **`query`** with the same embedder used for writes.
3. Server runs similarity search in **`tenant_<tenantId>.embeddings`** (optional filter by `types`, optional **`min_similarity`** filter in SQL when using pgvector).
4. Response: `data.items[]` with `text`, `score`, `type`, `metadata`.

**You do not** send a query vector in the JSON; only plain `query` text.

---

## 6. Embedder: noop vs OpenAI-compatible

| `EMBEDDER_MODE` | Behavior |
|-----------------|----------|
| `noop` or unset | No external API. Deterministic local vectors — good for CI and wiring. Search quality is not “semantic” like a real model. |
| **`minilm`** | Local **all-MiniLM-L6-v2** (384-d) via `@xenova/transformers` — same intent as the `daas-ai` PRD-04 notebook; **no embedding API spend**. First run downloads ONNX weights to cache. |
| `openai` | Calls `POST {EMBEDDING_API_BASE_URL}/embeddings` with `EMBEDDING_API_KEY` and `EMBEDDING_MODEL`. If key or model is missing, the server **falls back to noop** and logs a warning (safe until you configure secrets). |

**Dimension:** `KB_EMBEDDING_DIMENSION` must match the embedding length returned by the API and the `vector(n)` column created for each tenant (changing dimension after tables exist requires a migration or dropping/recreating tenant vector data).

Details: [KB_RETRIEVE_CONTRACT.md](./KB_RETRIEVE_CONTRACT.md) environment table.

---

## 7. Environment variables (quick reference)

| Variable | Role |
|----------|------|
| `VECTOR_DATABASE_URL` | Postgres connection string for the **vector** database only. |
| `ONBOARDING_VECTORSTORE_ADAPTER` | `noop` = no Postgres writes; `pgvector` = use Postgres/pgvector. |
| `EMBEDDER_MODE` | `noop` / **`minilm`** / `openai` (see §6). |
| `KB_EMBEDDING_DIMENSION` | Vector length (`384` with MiniLM, `1536` typical for OpenAI). |
| `EMBEDDING_API_BASE_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL` | Used when `EMBEDDER_MODE=openai`. |

Verify connectivity (from `daas-backend` folder):

```bash
npm run check:vector-db
```

---

## 8. Postman-style examples

**Auth:** obtain `access_token` from `POST /v1/auth/login`, then header `Authorization: Bearer <token>`.

**Put data in (glossary):**

```http
POST /v1/glossary
Content-Type: application/json

{
  "term": "Revenue",
  "definition": "Income recognized in the period.",
  "source": "user",
  "confidence": 1
}
```

**Search:**

```http
POST /v1/kb/retrieve
Content-Type: application/json

{
  "query": "what is revenue",
  "limit": 5,
  "types": ["glossary"],
  "min_similarity": 0.25
}
```

Expect `success: true` and `data.items` populated when `ONBOARDING_VECTORSTORE_ADAPTER=pgvector` and rows exist for that tenant.

---

## 9. Inspecting Postgres manually (WSL / psql)

Connect (use **single quotes** around the URL in bash if the password contains `!`):

```bash
psql 'postgresql://USER:PASSWORD@HOST:5432/vectordb'
```

List tenant schemas:

```sql
SELECT schema_name
FROM information_schema.schemata
WHERE schema_name LIKE 'tenant_%'
ORDER BY schema_name;
```

Inspect one tenant (replace schema with your real `tenant_<id>`):

```sql
SET search_path TO tenant_YOUR_TENANT_ID_HERE, public;
\d+ embeddings
SELECT collection_type, count(*) FROM embeddings GROUP BY 1;
SELECT id, collection_type, left(text, 80) AS preview FROM embeddings LIMIT 10;
```

---

## 10. Operational notes

- **Vector sync vs MySQL:** Glossary, business rules, and onboarding completion **save to MySQL first**. Postgres/pgvector sync runs **after** that. If Postgres or the embedder fails, the API **still returns success** for the primary write; the failure is **logged** (`glossary.vector_sync_failed`, `business_rule.vector_sync_failed`, `onboarding.vector_sync_failed`) so you can alert or retry out-of-band. A future improvement is a job queue to retry vector writes without silent drift.
- **Switching embedder or dimension:** Old vectors may no longer align with new queries; plan to **re-touch** glossary/rules (or a future reindex job) so chunks are re-embedded.
- **CI / tests:** Vitest pins `ONBOARDING_VECTORSTORE_ADAPTER=noop` and empty `VECTOR_DATABASE_URL` so tests do not need Postgres.
- **Related code (for developers):**
  - Pool: `src/lib/vectorPool.js`
  - Embedder: `src/services/embedder.client.js`
  - Adapter factory: `src/services/vectorstore.adapter.js`
  - Postgres implementation: `src/services/vectorstore.pgvector.js`
  - Retrieve: `src/services/kbRetrieve.service.js`, `src/routes/kb.routes.js`

---

## 11. Related documents

- [KB_RETRIEVE_CONTRACT.md](./KB_RETRIEVE_CONTRACT.md) — `POST /v1/kb/retrieve` JSON contract and env summary.
- [ONBOARDING_AI_SERVICE_CONTRACT.md](./ONBOARDING_AI_SERVICE_CONTRACT.md) — External onboarding AI payload (separate from pgvector writes).
