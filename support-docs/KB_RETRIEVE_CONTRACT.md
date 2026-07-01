# KB retrieve API (PRD-05)

For how the vector database fits in, how data is written, and how search works end-to-end, see **[PRD05_VECTOR_DATABASE_GUIDE.md](./PRD05_VECTOR_DATABASE_GUIDE.md)**.

Base path: `/v1/kb` (requires JWT like other v1 routes).

## POST /v1/kb/retrieve

**Auth:** `tenant_admin` (same as glossary list in V1).

**Request JSON**

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `query` | string | yes | Non-empty after trim. |
| `limit` | number | no | Integer 1–50; default 10. |
| `types` | string[] | no | Subset of collection types below; max 10 entries. |
| `min_similarity` | number | no | Cosine-style similarity in **[-1, 1]** (same as each item’s `score`). If set, only rows with `score >= min_similarity` are returned (then capped by `limit`). Matches PRD-04 notebook / `NumpyVectorStore.search(..., min_similarity=...)`. Omit for classic top‑K only (weaker matches can still appear). |
| `tenant_id` | any | ignored | If present, stripped and a warning is logged; tenant comes from the JWT. |

**Collection types (`types` values)**

Onboarding rounds (notebook-aligned):

- `business_context`
- `entity_definitions`
- `business_rules_enums`
- `clarification_qa_pairs`

Cross-cutting:

- `schema_summary`
- `assumptions`
- `glossary`
- `business_rule`

**Suggested default for planner / SQL retrieval:**  
`entity_definitions`, `clarification_qa_pairs`, `business_rules_enums`, `business_context`, `glossary`, `business_rule`, `assumptions`, `schema_summary`

**Success response** (`successResponse` envelope)

`data` object:

```json
{
  "items": [
    {
      "text": "matched chunk text",
      "score": 0.87,
      "type": "glossary",
      "metadata": {}
    }
  ]
}
```

- `score`: cosine-style similarity derived from pgvector distance (`1 - cosine_distance`), when using the pgvector adapter. With **`min_similarity`** on the request, every returned item satisfies `score >= min_similarity`.
- `metadata`: JSON object stored with the vector row (includes `tenant_id` and source ids where applicable).

**Errors**

- `422` — validation (e.g. empty `query`, bad `types` or `limit`).
- `500` — unexpected server error.

## Environment (backend)

| Variable | Purpose |
|----------|---------|
| `VECTOR_DATABASE_URL` | Postgres connection for pgvector (separate from MySQL). |
| `ONBOARDING_VECTORSTORE_ADAPTER` | `noop` (default) or `pgvector`. |
| `EMBEDDER_MODE` | `noop` or `off` (default): deterministic local vectors, no API. **`minilm`**: local [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) via `@xenova/transformers` (384-d, no spend; aligns with `daas-ai` PRD-04 notebook). `openai`: OpenAI-compatible `POST {EMBEDDING_API_BASE_URL}/embeddings` when `EMBEDDING_API_KEY` and `EMBEDDING_MODEL` are set; otherwise stays on noop until configured. |
| `KB_EMBEDDING_DIMENSION` | Must match the model output size (e.g. **`384`** with `minilm`**, `1536` for many OpenAI models). Used for noop length and pgvector `vector(n)`. |
| `EMBEDDER_MINILM_MODEL` | Optional; default `Xenova/all-MiniLM-L6-v2` when `EMBEDDER_MODE=minilm`. |
| `EMBEDDING_API_BASE_URL` | Default `https://api.openai.com/v1`. |
| `EMBEDDING_API_KEY` | Bearer token for the embedding API. |
| `EMBEDDING_MODEL` | e.g. `text-embedding-3-small`. |
| `EMBEDDING_API_TIMEOUT_MS` | Optional; default `30000`. |

## Tenant isolation

Vectors are stored per tenant in a Postgres schema `tenant_<tenantId>`. Every read/write uses the tenant id from the JWT, not from the request body.
