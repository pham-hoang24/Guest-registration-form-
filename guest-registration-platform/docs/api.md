# API Reference

Base URL: `http://localhost:3000`. All errors: `{ "error": "snake_case_code" }` (validation
errors add `details`). Owner routes require `Authorization: Bearer <jwt>`.

## Health

- `GET /health` → `{ "status": "ok" }`
- `GET /ready` → `{ "status": "ready" }` | 503 `{ "status": "not_ready" }` (checks DB)

## Public

### GET /v1/public/registration-links/:token
200:
```json
{
  "propertyName": "Example Cabin",
  "propertyCity": "Tampere",
  "requirementVersion": "FI-ACCOMMODATION-2026-01",
  "supportedLanguages": ["en", "fi", "sv"]
}
```
404 `invalid_or_expired_link` — unknown, disabled, and expired tokens are indistinguishable.

### POST /v1/public/registration-links/:token/submissions
Body: see `guestSubmissionRequestSchema` in `packages/shared`. Rules: valid `YYYY-MM-DD`
dates, `departureDate > arrivalDate`, 1–20 guests, exactly one `isPrimaryGuest`,
`privacyAccepted` and `accuracyConfirmed` must be `true`.

201: `{ "submissionId": "<uuid>", "status": "RECEIVED" }`
400 `validation_failed` · 404 `invalid_or_expired_link` · 429 `too_many_requests`

## Owner auth

### POST /v1/owner/auth/login
Body `{ "email", "password" }` →
200 `{ "token", "user": { "id", "email", "role", "tenantId" } }`
401 `invalid_credentials` (generic for every failure mode) · 429 after 10 attempts/15min.

### GET /v1/owner/auth/me
200 `{ "id", "email", "role", "tenantId" }`

## Owner resources (all tenant-scoped)

### GET /v1/owner/properties
200 `{ "properties": [ { "id", "name", "addressLine1", ... } ] }`

### GET /v1/owner/properties/:propertyId/submissions
200 `{ "property": {...}, "submissions": [ { "id", "status", "arrivalDate",
"departureDate", "purposeOfStay", "requirementVersion", "submittedAt", "guestCount" } ] }`
— metadata only, no guest names/contacts. 404 `not_found` for foreign property.

### GET /v1/owner/submissions/:submissionId
200: full submission detail incl. guests (names, DOB, nationality, documentType —
**never** document numbers) and `pdfAvailable`. Writes `OWNER_VIEWED_SUBMISSION` audit.

### GET /v1/owner/submissions/:submissionId/pdf
Roles: OWNER, MANAGER (VIEWER → 403 `forbidden`).
200: `application/pdf` attachment, `cache-control: no-store`. Writes `OWNER_DOWNLOADED_PDF`.
404 `not_found` · 409 `pdf_not_ready` · 500 `integrity_check_failed`
