# Onboarding AI Service Contract (PRD-04)

This document defines the backend-to-AI-module contract used by onboarding `advance`.

- Backend caller: `POST /v1/onboarding/sessions/:id/advance` flow in `daas-backend`
- AI owner: `daas-ai` module/service
- Purpose: AI module returns a strict onboarding decision payload (`needs_clarification` or `success`)

## Integration mode

Backend environment variables:

- `ONBOARDING_AI_SERVICE_ENABLED` (`"true"` to call external service)
- `ONBOARDING_AI_SERVICE_URL` (required when enabled)
- `ONBOARDING_AI_SERVICE_API_KEY` (optional bearer token)
- `ONBOARDING_AI_SERVICE_TIMEOUT_MS` (default `12000`)

If AI call fails or returns malformed payload, backend returns `502 agent_response_invalid`. Deterministic mode is only in daas-ai (`LLM_MODE=deterministic`).

## Vector sync

`needs_clarification` and `success` responses may include:

```json
"vector_sync": {
  "status": "ok",
  "adapter": "pgvector",
  "message": "Round 1 knowledge indexed.",
  "collections": { "clarification_qa_pairs": 2, "business_context": 1 },
  "round": 1
},
"round_completed": true
```

Indexing is performed in **daas-ai** (not daas-backend).

## Request payload (backend -> AI service)

```json
{
  "session": {
    "session_id": "sess_xxx",
    "tenant_id": "tenant_xxx",
    "data_source_id": "ds_xxx",
    "snapshot_id": "snap_xxx",
    "round_number": 1,
    "question_count": 5,
    "max_total_questions": 30
  },
  "snapshot": {
    "tables": [
      {
        "table_name": "orders",
        "row_estimate": 1200,
        "columns": [
          {
            "name": "status",
            "type": "varchar",
            "nullable": false,
            "is_primary_key": false
          }
        ],
        "primary_key": ["id"],
        "foreign_keys": [],
        "sample_rows": [{ "status": "pending" }]
      }
    ]
  },
  "answers": [
    {
      "questionId": "enum:orders:status",
      "answerText": "pending means order placed"
    }
  ],
  "answered_questions": ["enum:orders:status"]
}
```

Notes:

- `snapshot` uses the same PRD-03 contract shape returned by `/v1/schema-snapshots/:snapshotId`.
- `answers` are all session answers collected so far.

## Accepted response wrappers

Backend accepts these response forms from AI service and extracts the contract object from first match:

- `{ "data": { ...contractObject } }`
- `{ "result": { ...contractObject } }`
- `{ "response": { ...contractObject } }`
- `{ ...contractObject }`

## Contract object: `needs_clarification`

```json
{
  "status": "needs_clarification",
  "step": "onboarding",
  "reason": "Need business meanings for enum-like fields",
  "confidence": 0.62,
  "round_number": 2,
  "questions": [
    {
      "question_id": "enum:orders:status",
      "question": "What are the business meanings for orders.status values?",
      "category": "enum_definition",
      "context": "Observed values: pending, completed",
      "priority": 1
    }
  ]
}
```

Rules:

- `questions` max length: `5`
- `confidence` range: `0..1`

## Contract object: `success`

```json
{
  "status": "success",
  "step": "onboarding",
  "confidence": 0.91,
  "glossary_terms": [
    {
      "term": "orders.status",
      "definition": "Order lifecycle state",
      "source": "agent",
      "confidence": 0.9
    }
  ],
  "business_rules": [
    {
      "name": "orders_status_allowed_values",
      "expression": "orders.status IN (pending, completed, cancelled)",
      "description": "Valid statuses for orders",
      "source": "agent",
      "confidence": 0.9
    }
  ],
  "entity_descriptions": [
    {
      "entity_type": "table",
      "entity_name": "orders",
      "description": "Customer purchase orders",
      "source": "agent",
      "confidence": 0.88
    }
  ],
  "assumptions": [
    {
      "assumption": "status values are controlled by business workflow",
      "confidence": 0.75
    }
  ],
  "discovered_entities": ["orders", "order_items"],
  "enum_definitions": [
    {
      "entity_name": "orders",
      "field_name": "status",
      "values": ["pending", "completed", "cancelled"],
      "confidence": 0.93
    }
  ],
  "business_profile": {
    "domain": "commerce",
    "summary": "Order-centric transaction system"
  }
}
```

## Validation and persistence behavior in backend

After receiving AI response:

1. Backend validates payload against onboarding agent schema.
2. If `needs_clarification`:
   - session status becomes `waiting_for_answers`
   - session round/question counters are updated
3. If `success`:
   - upserts into `glossary_terms`, `business_rules`, `entity_descriptions`
   - session marked `complete`
   - datasource marked `onboarded=true`
   - vectorstore adapter receives deferred sync calls

## Error handling expectations

- AI service should return HTTP `2xx` with valid JSON payload.
- Any non-2xx or invalid payload triggers backend fallback path.
- Avoid markdown or natural-language wrappers; return JSON only.
