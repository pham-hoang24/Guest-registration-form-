# API Reference

Base URL: `http://localhost:3000`. All errors: `{ "error": "snake_case_code" }` (validation
errors add `details`). Owner routes authenticate via the `gr_owner_session` HttpOnly cookie
(set at login) or, when enabled, `Authorization: Bearer <jwt>`. **Cookie-authenticated
mutating requests (POST/PUT/PATCH/DELETE) require the `X-CSRF-Token` header**; Bearer-auth
requests skip CSRF. The CSRF token is returned by login and by `/me` (null for Bearer sessions).

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
  "requirementVersion": "FI-TEM-PASSENGER-CARD-2026-DRAFT-V1",
  "supportedLanguages": ["en", "fi", "sv"],
  "arrivalDate": "2026-07-20",
  "departureDate": "2026-07-23"
}
```
Stay dates are set by the owner when the link is created; the guest form displays them read-only.
404 `invalid_or_expired_link` — unknown, disabled, and expired tokens are indistinguishable.

### POST /v1/public/registration-links/:token/submissions
Body: see `guestSubmissionRequestSchema` in `packages/shared`. Rules: valid `YYYY-MM-DD`
dates, `departureDate > arrivalDate`, 1–20 guests, exactly one `isPrimaryGuest`,
`privacyAccepted` and `accuracyConfirmed` must be `true`.

201: `{ "submissionId": "<uuid>", "status": "RECEIVED" }`
400 `validation_failed` · 404 `invalid_or_expired_link` · 429 `too_many_requests`

## Owner auth

### POST /v1/owner/auth/login
Body `{ "email", "password" }` → sets the `gr_owner_session` HttpOnly, `SameSite=Strict`,
host-only cookie (`cache-control: no-store`, no token in the body) →
200 `{ "user": { "id", "email", "role", "tenantId" }, "csrfToken" }`
401 `invalid_credentials` (generic for every failure mode) · 429 after 10 attempts/15min.

### GET /v1/owner/auth/me
200 `{ "id", "email", "role", "tenantId", "csrfToken" }` — `csrfToken` is re-issued for a
cookie session so a page reload can recover it; `null` for a Bearer session.

### POST /v1/owner/auth/logout
Clears the session cookie; the session is invalid immediately afterwards.

## Owner resources (all tenant-scoped)

### GET /v1/owner/properties
200 `{ "properties": [ { "id", "name", "addressLine1", ... } ] }`

### POST /v1/owner/properties/:propertyId/active-registration-link
Roles: OWNER, MANAGER. Cookie sessions require `X-CSRF-Token`. Rate limited 5/property/hour
(denied VIEWER attempts do not consume quota). Body: `activeRegistrationLinkRequestSchema`
(`arrivalDate`, `departureDate`, `maxPassengerCards`, `linkTtlHours`).

Regenerates the property's single active link: any prior ACTIVE link → REVOKED, prior OPEN
stays → EXPIRED (empty) / CLOSED (submitted), then creates one new ACTIVE link + OPEN stay. A
partial unique index enforces **one active link per property**; a concurrent create loses the
race with 409 `active_link_conflict` (no URL, no audit row).

201: `{ "url", "createdAt", "expiresAt", "linkTtlHours" }`, `cache-control: no-store`. The
`url` is a **secret capability URL shown exactly once** — only its SHA-256 `tokenHash` is
stored, and the audit row (`REGISTRATION_LINK_REGENERATED`) carries counts/ids only, never the
token/URL/hash. 400 `validation_failed` · 403 `forbidden` · 404 `not_found` · 409
`active_link_conflict`.

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
