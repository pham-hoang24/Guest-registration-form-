# Backend Agent — Owner APIs and Server-Side PDF

## Prerequisites

- **Auth checker agent** must have completed: token source and middleware documented and implemented. All owner routes must be behind the auth middleware and have access to `req.owner` (e.g. `userId`, `tenantId`, `propertyIds`).
- **`agent-db-adapter`** must have completed: `InMemoryDb` replaced with real SQL adapter. The owner API endpoints read from real persistent storage — they are not useful against the in-memory DB in production. In dev/test, in-memory fallback is fine.

## Current state

`backend/src/routes/owner.ts` already implements:
- `GET /v1/owner/properties` (returns `req.owner.propertyIds` as a basic list — **no name/address yet**)
- `GET /v1/owner/submissions/:id/pdf` (full decrypt-and-stream pipeline — **complete and production-correct**)

**What is missing:** Properties list without names, no submissions list endpoint, no submission detail endpoint, no `tenant_name` column in DB.

## Goal

Implement the owner API contract from the master plan and serve the Matkustajailmoitus PDF from the server. No PII in frontend; PDF is filled only on the backend.

## Master plan reference

- [owner-dashboard-master.plan.md](owner-dashboard-master.plan.md) — API contract table, build order, PDF server-side only.

## API contract (implement exactly)

| Endpoint | Auth | Response | Error cases |
| -------- | ---- | -------- | ----------- |
| `GET /v1/owner/properties` | Bearer JWT | `{ properties: [{ id, name?, address?, pendingCount? }] }` | 401, 403 |
| `GET /v1/owner/properties/:id` | Bearer JWT | `{ id, name?, address?, status?, rent?, leaseEnd?, floorArea?, inspection? }` | 401, 403, 404 |
| `GET /v1/owner/properties/:id/submissions` | Bearer JWT | `{ submissions: [{ id, createdAt, status, tenantName? }] }` | 401, 403 |
| `GET /v1/owner/submissions/:id` | Bearer JWT | `{ id, createdAt, status, payload: { fullName, nationality, documentNumber, address, dateOfBirth, checkInDate, checkOutDate, phone?, email?, ... } }` | 401, 403, 404 |
| `GET /v1/owner/submissions/:id/pdf` | Bearer JWT | PDF blob + `Content-Disposition: attachment; filename="Matkustajailmoitus_Surname_GivenNames.pdf"` | 401, 403, 404 |

## Tasks

1. **GET /v1/owner/properties**
   - Use auth middleware; from `req.owner.propertyIds` (or equivalent) return the list of properties the owner can access. Each item: `id`, optional `name`, optional `address`, optional `pendingCount` (count of submissions in pending status for that property, for sidebar badge). Data from DB or existing in-memory store; add table or structure if missing.

2. **GET /v1/owner/properties/:id/submissions**
   - Ensure `:id` is in `req.owner.propertyIds`; else 403. Query DB for submissions for that property; return `{ submissions: [{ id, createdAt, status, tenantName? }] }`. **Source of tenantName:** If payload is stored encrypted at rest, JSON extraction (e.g. `payload->>'fullName'`) would return ciphertext, not a name. Therefore use a dedicated **`tenant_name` column** on the submissions table (populated on insert, unencrypted). The list query must read `tenant_name` from this column only; do not derive from encrypted payload.

3. **GET /v1/owner/submissions/:id**
   - Resolve submission by id; ensure the submission’s propertyId is in `req.owner.propertyIds`; else 403. If not found, 404. Return `{ id, createdAt, status, payload }` where `payload` is the stored guest registration payload (fullName, nationality, documentNumber, address, dateOfBirth, checkInDate, checkOutDate, phone, email, etc.). Payload may be decrypted if stored encrypted.

4. **GET /v1/owner/submissions/:id/pdf**
   - **ALREADY IMPLEMENTED** in `backend/src/routes/owner.ts`. The endpoint: verifies RBAC, unwraps DEK via Key Vault, verifies AAD hash and ciphertext hash, decrypts PDF, streams bytes. **Do not rewrite this.**
   - **What is not yet done:** The stored PDF is currently a JSON dump rendered by `pdf-lib` (default template v1). If the goal is to fill the Matkustajailmoitus modal form template, that requires loading `modal form.pdf`, mapping payload fields to PDF form fields (Text1–Text11, Check Box1–4), and flattening. If the modal form template is required, update `backend/src/pdf/templates/default/v1.ts` or add a new template — the template registry at `backend/src/pdf/registry.ts` supports multiple templates. **Name split for filename and Text1/Text2:** Use the canonical rule from the master plan: last space-delimited token = surname, everything before = given names; single-token = given only, surname empty. Sanitize the filename before setting `Content-Disposition`.

5. **GET /v1/owner/properties/:id** (property detail for hero-left)
   - Ensure `:id` is in `req.owner.propertyIds`; else 403. Return single property with `id`, `name?`, `address?`, `status?`, and optional `rent?`, `leaseEnd?`, `floorArea?`, `inspection?` so the dashboard hero-left can show a full property summary without shipping blank placeholders.

6. **Database / store**
   - Ensure tenant/registration payload is stored and retrievable per submission (existing payload store or DB). Ensure submissions table has **tenant_name** (unencrypted, populated on insert) for the list endpoint. Ensure properties list is available for the owner (e.g. property IDs from JWT or a properties table keyed by owner/tenant); add property detail fields (rent, leaseEnd, floorArea, inspection) if supporting GET /v1/owner/properties/:id.

## Out of scope

- Frontend code. MSW mocks (Frontend agent). Auth middleware implementation (Auth checker agent).

## Key files to read before implementing

- `backend/src/routes/owner.ts` — existing `/properties` and `/submissions/:id/pdf` implementations
- `backend/src/services/authz.ts` — `canReadSubmission` RBAC check (reuse for new endpoints)
- `backend/src/services/audit.ts` — `writeAudit` (call for all access events)
- `backend/src/services/db.ts` — current DB interface (will be real SQL after `agent-db-adapter`)
- `backend/src/pdf/registry.ts` — template registry for adding Matkustajailmoitus template
- `backend/src/pdf/templates/default/v1.ts` — existing pdf-lib template (reference for new template)

## Definition of done

- `GET /v1/owner/properties` returns properties with `name`, `address`, and `pendingCount`.
- `GET /v1/owner/properties/:id` returns property detail for hero-left.
- `GET /v1/owner/properties/:id/submissions` returns submissions list with `tenantName` from `tenant_name` column.
- `GET /v1/owner/submissions/:id` returns submission detail with decrypted payload.
- `GET /v1/owner/submissions/:id/pdf` already works — no change needed unless Matkustajailmoitus template is required.
- All endpoints return 401/403/404 as specified; all access events audited.
- No client-side PDF fill.
