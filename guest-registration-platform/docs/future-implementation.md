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

 Status: DONE with issues to tackle:
 ## Future production hardening notes

Current container/deployment work is acceptable for a controlled MVP/demo environment, but a few items must be revisited before real production use.

### 1. Remove OS metadata files from the repository

`.DS_Store` files should not be committed. They do not normally contain application secrets, but they are unnecessary OS metadata and create poor repository hygiene.

Future action:

```bash
git rm .DS_Store .claude/.DS_Store
echo ".DS_Store" >> .gitignore
echo ".DS_Store" >> guest-registration-platform/.dockerignore
```

### 2. Harden production Docker images

The current API and worker images copy the full monorepo and run TypeScript via `tsx`. This is acceptable for a fast MVP container build, but it is not ideal for production.

Current risk:

* production image contains source code, tests, docs, and development tooling;
* image size is larger than necessary;
* container compromise exposes more files than needed;
* dev/runtime boundary is weak.

Future action:

* use multi-stage Docker builds;
* compile TypeScript to JavaScript;
* install/prune production dependencies only;
* copy only required runtime files;
* avoid running `tsx` in production containers.

Target direction:

```txt
build stage:
  install deps
  generate Prisma client
  build TypeScript

runtime stage:
  copy dist/
  copy package metadata needed by runtime
  install/prune production deps
  run node dist/server.js
```

### 3. Move all public registration rate limiters to Redis

The login rate limiter is Redis-backed when `REDIS_URL` is configured. Public registration limiters are still in-memory per API process.

Current limitation:

```txt
publicGetRateLimit
publicPostRateLimit
publicPostHourlyRateLimit
```

are not distributed across API replicas. If the API runs multiple instances, attackers can bypass limits by spreading traffic across replicas.

Future action:

* add Redis stores for public registration GET/POST/hourly limiters;
* use separate Redis prefixes:

```txt
login:
pub-get:
pub-post:
pub-post-hr:
```

* ensure raw registration tokens are never stored in Redis keys;
* use hashed token values only.

### 4. Do not expose Redis in production

The local compose file exposes Redis to the host for development convenience. Production deployment should keep Redis internal-only.

Dev compose is acceptable:

```yaml
ports:
  - "6380:6379"
```

Production should avoid public/host exposure:

```yaml
expose:
  - "6379"
```

or use a managed private Redis service.

Redis must never be internet-accessible.

### 5. Treat compose secrets as development-only

The docker-compose file contains development placeholders such as `JWT_SECRET`, `FINGERPRINT_PEPPER`, and local KMS key material. These are acceptable only for local development.

Production must inject secrets from a real secret manager, for example Azure Key Vault or the deployment platform’s secret store.

Do not reuse compose values outside local development.

### 6. Pin and scan container images

Current images use tags such as:

```txt
node:22-alpine
nginx:1.27-alpine
postgres:16-alpine
redis:7-alpine
```

This is fine for MVP development, but production should prefer stronger supply-chain controls.

Future action:

* pin base images by digest;
* enable Dependabot/Renovate for Docker image updates;
* scan images in CI;
* fail builds on critical vulnerabilities where practical.

### 7. Pin GitHub Actions more strictly

The CI workflow uses version tags such as `actions/checkout@v4` and `docker/build-push-action@v6`. This is common, but stricter production hardening should pin actions by commit SHA.

Also add minimum workflow permissions:

```yaml
permissions:
  contents: read
```

### 8. Replace migrate-on-start before scaling

The API container currently runs Prisma migrations on startup. This is acceptable for a single-instance MVP, but unsafe when running multiple API replicas.

Current risk:

```txt
multiple API containers start
→ each tries migration deploy
→ race / startup instability
```

Future action:

* move migrations to a one-shot deployment job;
* start API only after migration success;
* keep API containers stateless and migration-free.

### 9. Keep nginx security headers and expand later

The web container already adds basic headers:

```txt
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
```

Future action:

* add a Content Security Policy after frontend asset/loading requirements stabilize;
* keep static web assets served without exposing unnecessary nginx defaults.

### Production readiness summary

Current status:

```txt
Good for controlled MVP/demo:
- non-root containers
- .env excluded from Docker context
- Redis-backed login limiter
- local full-stack compose
- basic nginx security headers
- dev-only secrets clearly marked
```

Not production-final yet:

```txt
- full source copied into API/worker images
- public registration limiters still in-memory
- Redis exposed to host in local compose
- dev secrets exist in compose
- image digests not pinned
- GitHub Actions not SHA-pinned
- migrations run on API startup
```

Before real production launch, fix:

```txt
1. remove committed .DS_Store files
2. build pruned production Docker images
3. move all public limiters to Redis
4. keep Redis private/internal-only
5. use real secret manager
6. add image scanning and digest pinning
7. move migrations to one-shot deployment job
```
## Future Implementation Notes — Production Safety Polish

The current MVP-RC codebase is suitable for local demo and controlled testing, but several production-hardening items remain. These are not blockers for local development, but they should be completed before real production deployment.

### 1. Redis-backed public registration rate limits

Current status:

* Owner login rate limiting can use Redis.
* Public guest registration rate limits are still per-process memory counters.
* `REDIS_URL` is required in production, but not all public limiters use Redis yet.

Risk:

* With multiple API replicas, each process has its own counter.
* Effective guest-link spam limits multiply by the number of running API instances.
* Public guest links remain weaker than intended under horizontal scaling.

Future fix:

* Add Redis-backed stores for:

  * public GET per IP + registration token
  * public POST per IP + registration token
  * public POST hourly per registration token
* Keep in-memory fallback only for development and tests.
* Verify Redis keys appear for public registration endpoints during smoke tests.

Acceptance:

* Production public registration limits are shared across all API replicas.
* `NODE_ENV=production` never silently falls back to in-memory rate limits.
* Public GET/POST/hourly limiter behavior is covered by tests or smoke checks.

---

### 2. Generic public registration-link unavailable response

Current status:

* Unknown registration tokens and unavailable links can return different public responses.
* Example distinction:

  * unknown token
  * revoked/expired/closed real token

Risk:

* An attacker may infer whether a registration link exists.
* This creates unnecessary token-enumeration signal.

Future fix:

* For public registration-link routes, return the same status and body for:

  * unknown token
  * revoked link
  * expired link
  * closed stay
  * inactive tenant
  * missing pre-created stay

Recommended response:

```json
{
  "error": "registration_link_unavailable"
}
```

Use the same HTTP status for all unavailable public-token cases, preferably `404`.

Acceptance:

* Unknown and unavailable links are indistinguishable to the client.
* Internal logs may record the real reason, but raw tokens must never be logged.

---

### 3. Fix additional-adult card holder contact fields

Current status:

* Passenger cards are correctly created per adult.
* However, card-holder metadata risks being copied from the primary guest or left null for additional-adult cards.

Risk:

* Additional adult cards may have incorrect or missing:

  * `cardHolderName`
  * `cardHolderEmail`
  * `cardHolderPhoneE164`

Future fix:

* For every `PassengerCard`, derive holder fields from `draft.people[0]`.
* For primary family card, this is the primary guest.
* For additional-adult card, this is the additional adult.

Expected logic:

```ts
const holder = draft.people[0];

cardHolderName = `${holder.firstName} ${holder.lastName}`;
cardHolderEmail = "email" in holder ? holder.email ?? null : null;
cardHolderPhoneE164 =
  "phone" in holder && holder.phone
    ? normalizeFinnishPhone(holder.phone)
    : null;
```

Acceptance:

* Additional-adult card stores that adult’s own holder name/contact.
* Primary family card stores the primary guest’s holder name/contact.
* Tests cover primary + spouse + child + additional adult.

---

### 4. Reject invalid phone numbers for every adult

Current status:

* Primary guest phone normalization failure returns validation error.
* Non-primary adult phone normalization may silently store `null`.

Risk:

* An additional adult can pass schema validation with a phone string, then lose the phone during persistence.
* Contact requirement becomes weaker than expected.

Future fix:

* Normalize all adult phone numbers before database insert.
* If any adult phone is present but invalid, return `400 validation_failed`.
* Do not silently drop invalid phone numbers.

Acceptance:

* Invalid primary phone returns `400`.
* Invalid additional-adult phone returns `400`.
* Valid Finnish formats normalize to E.164.

---

### 5. Remove route params from unauthorized-access audit metadata

Current status:

* Unauthorized role mismatch is audited.
* Audit metadata may include `req.params`.

Risk:

* Route parameters can include resource IDs.
* These are not necessarily PII, but they are unnecessary and increase audit-log sensitivity.

Future fix:

* Keep unauthorized-access audit metadata minimal:

```ts
metadata: {
  requiredRoles: [...roles],
  path: req.path,
  method: req.method,
}
```

Do not include:

* `req.params`
* query strings
* `req.originalUrl`
* raw tokens
* raw IP
* raw user agent

Acceptance:

* `UNAUTHORIZED_ACCESS_ATTEMPT` audit rows contain only role requirement, path, method, hashed IP, and hashed user agent.
* No route params or query strings are stored.

---

### 6. Add `Cache-Control: no-store` to `/me`

Current status:

* Login and logout responses set `Cache-Control: no-store`.
* The owner `/me` endpoint returns authenticated owner identity and should also be non-cacheable.

Future fix:

```ts
res.setHeader("cache-control", "no-store");
```

Acceptance:

* `/v1/owner/auth/me` always returns `Cache-Control: no-store`.

---

### 7. Clarify local Docker cookie behavior

Current status:

* In production mode, owner auth cookies are marked `Secure`.
* Local Docker Compose exposes API over plain HTTP.
* Browsers do not send `Secure` cookies over plain HTTP.

Risk:

* Curl smoke tests may pass, but browser-based local login can fail unless HTTPS is used or secure-cookie behavior is overridden for local development.

Future fix options:

1. Add a local-only override:

```env
OWNER_COOKIE_SECURE=false
```

2. Or run local compose behind an HTTPS dev proxy.

Production rule:

* Production must keep secure cookies enabled.
* Never disable `Secure` cookies in real deployment.

Acceptance:

* Browser login works in local compose.
* Production remains HTTPS-only for auth cookies.

---

### 8. Replace production `tsx` runtime with compiled Node runtime

Current status:

* API and worker containers run TypeScript source via `tsx`.
* Images install full workspace dependencies.

Risk:

* Larger runtime image.
* More dev tooling in production.
* Slower cold start.
* Larger attack surface.

Future fix:

* Build TypeScript during image build.
* Run compiled JavaScript with `node`.
* Use multi-stage Dockerfiles.
* Prune dev dependencies or use a production deployment layout.

Target shape:

```dockerfile
RUN pnpm build
CMD ["node", "dist/server.js"]
```

Acceptance:

* API and worker images run compiled JS.
* Runtime images do not require `tsx`.
* Runtime images contain only production dependencies where practical.

---

### 9. Keep local worker override out of production

Current status:

* The worker Dockerfile’s real command runs the Azure Service Bus consumer.
* Local `docker-compose.yml` overrides the worker command to run retention cleanup because local compose does not include Azure Service Bus.
* PDF generation in local compose happens inline through the API with `QUEUE_PROVIDER=in-process`.

This is acceptable for local development.

Production rule:

* Production worker must run the real worker entrypoint.
* Production must not use the local retention-only command override.
* Production should use Azure Service Bus or another real queue provider.

Acceptance:

* Deployment docs clearly state that the compose worker override is local-only.
* Production worker consumes PDF jobs from the queue.
* API does not perform PDF generation inline in production unless explicitly allowed for a single-instance emergency/demo setup.

---

### 10. Add stricter web security headers later

Current status:

* Nginx sets:

  * `X-Content-Type-Options`
  * `Referrer-Policy`
  * `X-Frame-Options`

Future improvement:

* Add a Content Security Policy after frontend behavior is stable.

Example starting point:

```nginx
add_header Content-Security-Policy "default-src 'self'; connect-src 'self' https://api.example.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" always;
```

Acceptance:

* CSP is tested against the guest form, owner dashboard, signature pad, and API calls.
* No inline script requirements are introduced accidentally.

---

## Recommended Next Slice

### Slice C — Production Safety Polish

Implement before adding more product features:

1. Redis-backed public registration rate limiters.
2. Generic public registration-link unavailable response.
3. Correct additional-adult card-holder metadata.
4. Reject invalid phone numbers for every adult.
5. Remove route params from unauthorized-access audit metadata.
6. Add `Cache-Control: no-store` to `/me`.
7. Clarify local Docker secure-cookie behavior.

### Slice C Acceptance Criteria

* Public registration rate-limit keys appear in Redis.
* Unknown, revoked, expired, closed, and inactive links return identical public unavailable responses.
* Additional-adult cards store the additional adult’s own holder name/contact.
* Invalid phone numbers fail validation for every adult.
* Unauthorized-access audit metadata contains no params, query strings, raw IPs, raw user agents, or tokens.
* `/me` response is marked `Cache-Control: no-store`.
* Browser login works in local compose, or local HTTPS requirement is documented clearly.



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
apps/api/src/routes/ownerPassengerCards.ts
```

> The PDF download/decrypt/stream flow lives in `ownerPassengerCards.ts` (route
> `GET /:passengerCardId/pdf`), where the `PDF_INTEGRITY_FAILED` (sha256 mismatch) and
> `PDF_DECRYPT_FAILED` (decrypt/auth-tag failure) audit branches are wired. The JSON
> metadata endpoint `ownerSubmissions.ts` does not touch crypto and is not involved.

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
apps/api/src/middleware/rbac.ts
```

> Already implemented in commit `5be27f3` — `requireRole` lives in `rbac.ts`, not `auth.ts`.

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

---

# Slice C — Production Safety Polish: Status

Implemented (see `apps/api/src/middleware/rateLimit.ts`, `apps/api/src/routes/publicRegistration.ts`,
`apps/api/src/middleware/rbac.ts`, `apps/api/src/routes/ownerAuth.ts`, `apps/api/src/config.ts`):

1. **Redis-backed public rate limiters — done, and a worse bug than documented was
   found and fixed.** The limiters weren't just per-process; `publicGetRateLimit`/
   `publicPostRateLimit`/`publicPostHourlyRateLimit` were constructed fresh *inside
   each request handler*, so the in-memory store never survived past the request
   that created it — they blocked nothing, even on one instance. Fixed by building
   each limiter once at router setup and passing a shared store (Redis-backed via
   `pub-get:`/`pub-post:`/`pub-post-hr:` prefixes when `REDIS_URL` is set, one shared
   in-memory store otherwise). Limiters now run before `upload.any()`.
2. **Generic unavailable response — fixed, was not actually done.** Unknown tokens
   previously returned a different response (`404 registration_link_not_found`) than
   known-but-unavailable ones (`410 registration_link_unavailable`) — still a
   token-enumeration signal. Both now return an identical `404
   registration_link_unavailable` on GET and POST.
3. **Additional-adult card-holder fields — fixed.** `cardHolderName/Email/PhoneE164`
   now derive from `draft.people[0]` (the real card holder) instead of always the
   primary guest.
4. **Phone validation for every adult — fixed.** Every adult's phone (primary +
   each additional adult) is normalized up front; a present-but-invalid phone fails
   the whole request with `400 validation_failed` instead of being silently dropped
   for non-primary adults.
5. **RBAC audit metadata — fixed.** `UNAUTHORIZED_ACCESS_ATTEMPT` metadata no longer
   spreads `req.params`; `requiredRoles` is an array.
6. **`/me` cache header — fixed.** `Cache-Control: no-store` added, matching
   `/login`/`/logout`.
7. **`OWNER_COOKIE_SECURE` override — added, guarded.** `ownerCookieSecure = isProd
   || env.OWNER_COOKIE_SECURE === "true"` — the env var can only opt in to secure
   cookies outside production, never opt out of them in production. Testing the
   *production Docker image* locally over plain HTTP (as in the Tier 1 Slice B smoke
   test) is intentionally not unblocked by this — use an HTTPS dev proxy for that.

Also done as cheap hygiene: removed the two committed `.DS_Store` files from git
tracking and added `.DS_Store` to the root `.gitignore` and to
`guest-registration-platform/.dockerignore`.

**Not done in this slice** (infra/deployment hardening, not code correctness —
tracked separately): Docker multi-stage builds for `api`/`worker` (only `web` has
one), GitHub Actions SHA-pinning + `permissions: contents: read`, Redis
host-exposure in dev compose, container image digest pinning, and moving Prisma
`migrate deploy` off the API container's startup path before running multiple
replicas.
