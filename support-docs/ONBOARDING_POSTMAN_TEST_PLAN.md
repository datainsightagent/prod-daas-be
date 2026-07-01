# Onboarding Postman Test Plan (Implemented Scope)

Use this to verify Phase 1-3 onboarding backend implementation.

## Prerequisites

- API server running (`npm run dev`)
- Schema scan worker running (`npm run dev:worker:schema-scan`) if new snapshots are needed
- DB migrated with latest Prisma migrations
- Valid tenant-admin user credentials
- At least one datasource with a `ready` snapshot

## Postman environment variables

- `baseUrl` (example: `http://localhost:5000`)
- `email`
- `password`
- `tenantSlug`
- `accessToken` (set from login response)
- `dataSourceId`
- `sessionId`

## Collection auth setup

- For protected routes add header:
  - `Authorization: Bearer {{accessToken}}`
  - `Content-Type: application/json`

## Test sequence

### 1) Login (get token)

- **Request**: `POST {{baseUrl}}/v1/auth/login`
- **Body**:

```json
{
  "email": "{{email}}",
  "password": "{{password}}",
  "tenant_slug": "{{tenantSlug}}"
}
```

- **Checks**:
  - HTTP `200`
  - `success=true`
  - `data.access_token` exists

Store `data.access_token` into `accessToken`.

### 2) Optional: list data sources

- **Request**: `GET {{baseUrl}}/v1/data-sources`
- **Checks**:
  - HTTP `200`
  - pick a datasource with usable schema snapshot

### 3) Optional: list snapshots for datasource

- **Request**: `GET {{baseUrl}}/v1/data-sources/{{dataSourceId}}/schema-snapshots`
- **Checks**:
  - HTTP `200`
  - at least one snapshot in `ready` state

### 4) Start onboarding session

- **Request**: `POST {{baseUrl}}/v1/onboarding/sessions`
- **Body**:

```json
{
  "data_source_id": "{{dataSourceId}}"
}
```

- **Checks**:
  - HTTP `201`
  - `data.session_id` present
  - `data.status` is `active`
  - `data.snapshot_id` present

Store `data.session_id` into `sessionId`.

### 5) Advance without answers (expect clarification or success)

- **Request**: `POST {{baseUrl}}/v1/onboarding/sessions/{{sessionId}}/advance`
- **Body**:

```json
{}
```

- **Checks**:
  - HTTP `200`
  - `data.status` is either `needs_clarification` or `success`
  - if `needs_clarification`, max `5` questions

### 6) Advance with answers (if clarification returned)

- **Request**: `POST {{baseUrl}}/v1/onboarding/sessions/{{sessionId}}/advance`
- **Body example**:

```json
{
  "answers": [
    {
      "question_id": "enum:orders:status",
      "answer": "pending, completed, cancelled"
    }
  ]
}
```

- **Checks**:
  - HTTP `200`
  - returns either next `needs_clarification` or `success`

### 7) Get session state (resume behavior)

- **Request**: `GET {{baseUrl}}/v1/onboarding/sessions/{{sessionId}}`
- **Checks**:
  - HTTP `200`
  - status reflects latest progression (`waiting_for_answers` or `complete`)
  - round/question counters changed over time

### 8) Complete session explicitly

- **Request**: `POST {{baseUrl}}/v1/onboarding/sessions/{{sessionId}}/complete`
- **Checks**:
  - HTTP `200`
  - `data.completed=true`
  - `data.status=complete`

### 9) Verify datasource onboarded flag

- **Request**: `GET {{baseUrl}}/v1/data-sources/{{dataSourceId}}`
- **Checks**:
  - HTTP `200`
  - datasource is onboarded (verify backend output field once exposed in detail/list payloads)

### 10) Verify generated knowledge on success

- **Request**: `GET {{baseUrl}}/v1/glossary`
- **Checks**:
  - HTTP `200`
  - terms include AI-generated entries when `success` path executed

## Negative tests

### A) Invalid start payload

- `POST /v1/onboarding/sessions` with empty body
- Expect HTTP `400`, `validation_error`

### B) Invalid advance payload

- `POST /advance` with `answers` not array / bad shape
- Expect HTTP `400`, `validation_error`

### C) Cross-tenant/not found

- Use session or datasource from another tenant
- Expect HTTP `404`, `not_found`

### D) Advance finalized session

- Call `/advance` after session is `complete`
- Expect HTTP `409`, `session_already_finalized`

### E) No ready snapshot

- Start onboarding on datasource without `ready` snapshot
- Expect HTTP `409`, `snapshot_not_ready`

## Optional AI-service specific checks

If using external AI service:

- Set in `.env`:
  - `ONBOARDING_AI_SERVICE_ENABLED=true`
  - `ONBOARDING_AI_SERVICE_URL=...`
- Run step 5/6 and confirm responses still follow same backend schema.
- Temporarily break service URL and re-run step 5:
  - request should still succeed via deterministic fallback.

## Exit criteria

- Happy path works from session start to success/complete.
- Validation and isolation errors return expected codes.
- Session state is resumable and consistent.
- Knowledge writes happen when success is produced.
