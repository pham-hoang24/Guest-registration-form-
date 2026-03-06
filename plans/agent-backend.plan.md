# Backend Agent — Owner APIs and Server-Side PDF

## Prerequisite

- **Auth checker agent** must have completed: token source and middleware documented and implemented. All owner routes must be behind the auth middleware and have access to `req.owner` (e.g. `userId`, `tenantId`, `propertyIds`).

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
   - Same auth and ownership check as submission detail. Load the modal form template ([modal form.pdf](modal form.pdf) or equivalent path in backend). Fill it server-side (e.g. with pdf-lib or equivalent): map payload to PDF fields (Text1–Text11, Check Box1–4, etc. — sukunimi, etunimet, syntyma, kansalaisuus, passi, osoite, saapuminen, lahto, maa, tarkoitus). **Name split for filename and Text1/Text2:** Use the canonical rule from the master plan (Overview): last space-delimited token = surname, everything before = given names; single-token = given only, surname empty. Flatten the form, return PDF bytes with `Content-Type: application/pdf` and `Content-Disposition: attachment; filename="Matkustajailmoitus_Surname_GivenNames.pdf"` (sanitize filename). If the existing endpoint already returns a server-generated PDF, align it to use the modal form template and the same field mapping.

5. **GET /v1/owner/properties/:id** (property detail for hero-left)
   - Ensure `:id` is in `req.owner.propertyIds`; else 403. Return single property with `id`, `name?`, `address?`, `status?`, and optional `rent?`, `leaseEnd?`, `floorArea?`, `inspection?` so the dashboard hero-left can show a full property summary without shipping blank placeholders.

6. **Database / store**
   - Ensure tenant/registration payload is stored and retrievable per submission (existing payload store or DB). Ensure submissions table has **tenant_name** (unencrypted, populated on insert) for the list endpoint. Ensure properties list is available for the owner (e.g. property IDs from JWT or a properties table keyed by owner/tenant); add property detail fields (rent, leaseEnd, floorArea, inspection) if supporting GET /v1/owner/properties/:id.

## Out of scope

- Frontend code. MSW mocks (Frontend agent). Auth middleware implementation (Auth checker agent).

## Definition of done

- All four endpoints implemented and protected by auth middleware.
- GET /v1/owner/properties returns the owner’s properties.
- GET submissions and GET submission/:id return data per contract; 401/403/404 as specified.
- GET submission/:id/pdf returns the filled Matkustajailmoitus PDF with correct Content-Disposition. No client-side PDF fill.
