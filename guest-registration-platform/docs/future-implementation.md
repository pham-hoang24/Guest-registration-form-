 Here is Claude's plan:
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Guest Registration Platform — Gap Closure Plan

 Context

 The user's MVP feature plan was audited against the codebase. The greenfield monorepo at guest-registration-platform/ already implements all P0 and P1 items end-to-end:
 hashed property registration tokens, multi-guest mobile-first form with EN/FI/SV i18n, zod backend validation, PDF generation with requirement_version, AES-256-GCM
 envelope encryption (local KMS + Azure Key Vault), bcrypt owner login with rate limiting, tenant-scoped submissions list and PDF download, audit logging with hashed
 IP/UA, retention fields + deletion worker, seed script, and CI. The MVP "Definition of Done" checklist is functionally met for local dev.

 What remains is a set of concrete hardening/deployment gaps found during the audit. This plan closes them in priority order. The legacy backend/+frontend/ tree is a
 superseded parallel implementation — it is not modified here (only mined for one feature: the JWKS/RS256 verifier).

 Audit result vs MVP plan (summary)

 ┌───────────────────────────────────────────────────────┬────────────────────────────────────────────────────────────────┐
 │                       MVP item                        │                             Status                             │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ Property token link (hashed, unguessable)             │ ✅ Done — packages/crypto/src/tokens.ts, publicRegistration.ts │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ Guest form + confirmation checkboxes                  │ ✅ Done — apps/web/src/guest/GuestRegistrationPage.tsx         │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ FI/EN (and SV) i18n                                   │ ✅ Done — apps/web/src/i18n/                                   │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ Backend validation                                    │ ✅ Done (gap: schemas not .strict())                           │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ PDF generation + requirement_version                  │ ✅ Done (gap: placeholder legal version; non-Latin-1 → ?)      │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ Encrypted PDF storage (AES-256-GCM, AAD, key version) │ ✅ Done — packages/crypto/src/envelope.ts, EncryptedPdf model  │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ Owner login (bcrypt, rate-limited, audited)           │ ✅ Done (gap: JWT in localStorage, HS256-only)                 │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ Owner submissions list + tenant isolation             │ ✅ Done                                                        │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ PDF download (decrypt in memory, audited)             │ ✅ Done (gap: decrypt failures not audited)                    │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ Audit logs                                            │ ✅ Done (gap: no decrypt-fail / unauthorized-attempt events)   │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ Retention fields + deletion worker                    │ ✅ Done                                                        │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ Seed owner/property/token                             │ ✅ Done — packages/db/src/seed.ts                              │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ QR code                                               │ ❌ Not built (P1)                                              │
 ├───────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ Dockerfiles / deploy for monorepo apps                │ ❌ Missing (compose has Postgres only)                         │
 └───────────────────────────────────────────────────────┴────────────────────────────────────────────────────────────────┘

 Work plan

 Tier 1 — Security & correctness gaps (small, high value)

 1. Audit decrypt/integrity failures and unauthorized attempts
   - apps/api/src/routes/ownerSubmissions.ts: on sha256 mismatch or decrypt failure, write audit events (add PDF_DECRYPT_FAILED, PDF_INTEGRITY_FAILED to the AuditAction
 enum in packages/db/prisma/schema.prisma) before returning the error.
   - Add an UNAUTHORIZED_ACCESS_ATTEMPT audit write on 403s in requireRole (apps/api/src/middleware/auth.ts) for owner routes.
 2. Reject unknown fields in guest submission
   - Add .strict() to guestSubmissionRequestSchema and guestSchema in packages/shared/src/schemas/registration.ts (MVP plan explicitly requires rejecting unknown
 fields). Verify web form still submits (it uses the same schema, so it will).
 3. Tests for ownerUsers.ts routes
   - New apps/api/tests/ownerUsers.test.ts following the pattern in ownerAccess.test.ts: OWNER-only RBAC, last-active-OWNER protection, duplicate email 409, audit
 events.

 Tier 2 — Production auth & deployment

 4. Port RS256/JWKS owner-token verification to the monorepo
   - Source: legacy backend/src/middleware/ownerAuth.ts (JWKS fetch/cache, HTTPS-only guard). Target: apps/api/src/middleware/auth.ts — when OWNER_JWKS_URI is set,
 verify RS256 via JWKS; otherwise keep HS256 dev path. Keep the existing DB re-check of user/tenant ACTIVE status.
 5. Move the owner session from localStorage JWT to an httpOnly cookie (or, minimally, document the XSS exposure and shorten expiry) — touches
 apps/api/src/routes/ownerAuth.ts, apps/web/src/owner/OwnerAuthContext.tsx, CORS config in app.ts (credentials: true).
 6. Dockerfiles + compose for api/web/worker
   - Add apps/api/Dockerfile, apps/web/Dockerfile (static build behind nginx), apps/worker/Dockerfile (pnpm monorepo multi-stage builds; the legacy Dockerfiles show the
 pattern but need pnpm workspace adaptation). Extend docker-compose.yml beyond Postgres so the full stack runs containerized.
   - Optionally add a CI build stage in .github/workflows/ci.yml.
 7. Distributed rate limiting note — the in-memory express-rate-limit store resets per instance; either add a Redis store or (simpler for one-instance MVP) document it
 as a known limit in docs/threat-model.md.

 Tier 3 — MVP polish (P1 items from the feature plan)

 8. QR code generation — owner UI: render a QR for each property's registration link (client-side qrcode lib on OwnerPropertiesPage.tsx, PNG download). Note: raw tokens
 are only shown at seed/link-creation time, so QR must be generated where the raw link is available (link creation response), not from the stored hash.
 9. Unicode font in PDFs — embed a font via @pdf-lib/fontkit in packages/pdf/src/registrationPdf.ts so Finnish/Swedish/other names don't degrade to ? (the legacy
 backend/src/pdf/templates/default/v1.ts already does this — reuse its approach).
 10. Country-of-residence field — the MVP field list includes it; the current form has only free-text address. Add countryOfResidence (ISO alpha-2) to guestSchema, the
 Prisma Guest model, the form, and the PDF.

 Tier 4 — Track, don't build yet

 - Legal verification of REQUIREMENT_VERSION fields and retention periods against Finnish Act 308/2006 before a real pilot (TODOs already flagged in registrationPdf.ts
 and docs/retention-policy.md) — a human/legal task, not code.
 - Azure IaC (Bicep) for Container Apps/Service Bus/Key Vault — after Dockerfiles exist.
 - DEK rewrap/key-rotation job (exists in legacy tree only) — post-MVP.
 - Archiving/removing the legacy backend/+frontend/ tree once nothing else needs porting from it.

 Verification

 - pnpm lint && pnpm typecheck && pnpm test at the monorepo root (CI runs the same against Postgres 16).
 - Tier 1: new/updated Vitest suites in apps/api/tests/ assert the new audit events and 400 on unknown fields.
 - Tier 2: run the full stack via the new docker-compose; seed (packages/db/src/seed.ts), open the printed registration link, submit as a guest, log in as owner,
 download the PDF — the MVP Definition-of-Done walkthrough. Test RS256 path with a local JWKS fixture (pattern exists in legacy backend/tests).
 - Tier 3: visual check of QR render + a PDF containing ä/ö/å and non-Latin names.

 # Sprint 1 Plan — MVP Release Candidate Hardening

## Sprint Goal

Ship a hardened local MVP release candidate by closing the highest-value security, validation, and RBAC gaps.

By the end of this sprint, the system should have:

* Audit logs for failed PDF decrypt/integrity events
* Audit logs for unauthorized owner access attempts
* Strict backend validation that rejects unknown guest fields
* Test coverage for owner-user RBAC and safety rules
* Passing lint, typecheck, and test suite

---

## Scope

This sprint only covers Tier 1 hardening.

### Included

* Audit event additions
* PDF download failure audit logging
* Unauthorized access attempt audit logging
* Strict guest submission schemas
* Owner users route tests
* Regression tests for new behavior

### Excluded

* QR code generation
* Dockerfiles
* JWKS/RS256 auth
* httpOnly cookie migration
* Unicode PDF font
* country-of-residence field
* Azure deployment
* Key rotation
* Dashboard polish

---

# Task 1 — Add Security Audit Actions

## Goal

Record security-relevant failure events instead of silently returning errors.

## Files

```txt
packages/db/prisma/schema.prisma
```

## Add audit enum values

Add these values to the existing `AuditAction` enum:

```ts
PDF_DECRYPT_FAILED
PDF_INTEGRITY_FAILED
UNAUTHORIZED_ACCESS_ATTEMPT
```

## Expected result

The database schema supports audit records for:

* PDF decryption failure
* PDF integrity/hash mismatch
* Unauthorized owner access attempt

## Acceptance Criteria

* Prisma schema includes the new enum values
* Migration is generated
* Existing audit events still work
* Tests compile against the updated enum

---

# Task 2 — Audit PDF Decrypt and Integrity Failures

## Goal

When a PDF download fails due to decryption or integrity problems, write an audit log before returning an error.

## Files

```txt
apps/api/src/routes/ownerSubmissions.ts
```

## Required Behavior

### Successful download

```txt
Owner downloads valid PDF
→ write PDF_DOWNLOADED audit event
→ return decrypted PDF
```

### Integrity mismatch

```txt
Stored/decrypted PDF hash does not match expected sha256
→ write PDF_INTEGRITY_FAILED audit event
→ return error
```

### Decrypt failure

```txt
PDF decrypt throws or authentication tag fails
→ write PDF_DECRYPT_FAILED audit event
→ return error
```

## Implementation Notes

Do not log plaintext PDF data.

Audit metadata may include:

```ts
{
  submissionId,
  propertyId,
  tenantId,
  ownerUserId,
  reason: "sha256_mismatch" | "decrypt_failed"
}
```

Keep error responses generic.

Good:

```txt
PDF could not be retrieved.
```

Bad:

```txt
AES-GCM authentication tag failed for key version local-v1.
```

## Acceptance Criteria

* Failed decrypt writes `PDF_DECRYPT_FAILED`
* Hash mismatch writes `PDF_INTEGRITY_FAILED`
* Successful download still writes existing download audit event
* No plaintext guest data or PDF bytes are logged
* Existing PDF download tests still pass

---

# Task 3 — Audit Unauthorized Owner Access Attempts

## Goal

When an authenticated owner user tries to access a resource they are not allowed to access, write an audit event.

## Files

```txt
apps/api/src/middleware/auth.ts
```

## Required Behavior

When `requireRole` or owner authorization returns `403`:

```txt
→ write UNAUTHORIZED_ACCESS_ATTEMPT audit event
→ return 403
```

## Audit Metadata

Include only safe metadata:

```ts
{
  ownerUserId,
  tenantId,
  requiredRoles,
  path,
  method
}
```

If available, include:

```ts
{
  propertyId,
  submissionId
}
```

## Important

Do not block the response if audit writing fails.

Use best-effort audit logging:

```txt
authorization failure should still return 403
audit failure should not create 500
```

## Acceptance Criteria

* Unauthorized owner route access writes `UNAUTHORIZED_ACCESS_ATTEMPT`
* Response remains `403`
* Audit failure does not crash the request
* No sensitive guest data is logged

---

# Task 4 — Reject Unknown Guest Submission Fields

## Goal

Prevent clients from submitting unexpected fields to the backend.

## Files

```txt
packages/shared/src/schemas/registration.ts
```

## Change

Add `.strict()` to:

```ts
guestSchema
guestSubmissionRequestSchema
```

Example:

```ts
export const guestSchema = z.object({
  // existing fields
}).strict();

export const guestSubmissionRequestSchema = z.object({
  // existing fields
}).strict();
```

## Required Test

Add or update a test:

```txt
POST /v1/guest/register with an unexpected top-level field
→ 400
```

Also test nested guest field if the schema supports multiple guests:

```txt
guest includes unexpected field
→ 400
```

## Acceptance Criteria

* Unknown top-level fields are rejected
* Unknown guest-level fields are rejected
* Valid web form submission still works
* Frontend type inference still works

---

# Task 5 — Add Owner Users Route Tests

## Goal

Lock the owner-user management behavior with tests.

## New File

```txt
apps/api/tests/ownerUsers.test.ts
```

Follow the existing pattern from:

```txt
apps/api/tests/ownerAccess.test.ts
```

## Test Cases

### 1. OWNER can manage owner users

Expected:

```txt
OWNER request
→ allowed
```

### 2. MANAGER cannot manage owner users

Expected:

```txt
MANAGER request
→ 403
→ UNAUTHORIZED_ACCESS_ATTEMPT audit event
```

### 3. VIEWER cannot manage owner users

Expected:

```txt
VIEWER request
→ 403
→ UNAUTHORIZED_ACCESS_ATTEMPT audit event
```

### 4. Cannot deactivate/remove last active OWNER

Expected:

```txt
Attempt to deactivate/remove final active OWNER
→ 400 or 409
→ owner remains active
```

### 5. Duplicate email returns 409

Expected:

```txt
Create owner user with existing email
→ 409
```

### 6. Successful owner-user change writes audit event

Expected:

```txt
Owner user created/updated/deactivated
→ audit event written
```

## Acceptance Criteria

* New test file exists
* Tests cover OWNER, MANAGER, and VIEWER permissions
* Tests cover last active OWNER protection
* Tests cover duplicate email conflict
* Tests cover audit events
* Full test suite passes

---

# Task 6 — Verification

Run from the monorepo root:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

If database migrations are required:

```bash
pnpm prisma migrate dev
```

or the repo’s existing migration command.

## Manual Smoke Test

After automated checks pass:

```txt
1. Seed owner and property.
2. Open property registration link.
3. Submit guest registration.
4. Log in as owner.
5. View submissions list.
6. Download PDF.
7. Confirm PDF opens.
8. Confirm audit log includes submission, PDF generation, and PDF download.
```

For failure paths:

```txt
1. Attempt unauthorized owner access.
2. Confirm 403.
3. Confirm UNAUTHORIZED_ACCESS_ATTEMPT audit event.

4. Simulate PDF integrity mismatch.
5. Confirm download fails.
6. Confirm PDF_INTEGRITY_FAILED audit event.

7. Simulate decrypt failure.
8. Confirm download fails.
9. Confirm PDF_DECRYPT_FAILED audit event.
```

---

# Definition of Done

Sprint 1 is done when:

* New audit actions are added
* PDF decrypt failures are audited
* PDF integrity failures are audited
* Unauthorized owner access attempts are audited
* Guest submission schemas reject unknown fields
* Owner-user route tests exist and pass
* `pnpm lint` passes
* `pnpm typecheck` passes
* `pnpm test` passes
* Manual MVP smoke test passes

---

# Suggested Commit Order

```txt
feat(audit): add security failure actions
feat(audit): log PDF decrypt and integrity failures
feat(audit): log unauthorized owner access attempts
fix(validation): reject unknown guest submission fields
test(owner-users): cover RBAC and owner safety rules
chore(release): mark MVP RC1 readiness
```

---

# Sprint Output

At the end of this sprint, tag the state as:

```txt
MVP-RC1
```

Meaning:

```txt
The local MVP flow is functionally complete and hardened enough for a controlled demo with one real property owner.
```
