# Guest Registration Platform — CLAUDE.md

Multi-tenant guest registration for accommodation providers in Finland. Guests submit via a
unique link; the backend renders an authority-ready PDF, encrypts it with envelope
encryption, and stores only ciphertext. Owners access submissions through an audited,
role-gated dashboard.


## The invariants (never break these)

These are the product. A feature that violates one is a regression even if it "works".

1. **Plaintext PDFs never touch disk, DB, or logs.** They exist only in memory during
   generate/encrypt and decrypt/stream. Downloads use `cache-control: no-store`.
2. **Envelope encryption, fresh keys per document.** One random 32-byte DEK + 12-byte IV
   per PDF, AES-256-GCM, DEK wrapped by `KmsProvider`, DEK buffer zeroed after wrapping.
   Only the wrapped DEK is persisted. Same scheme for guest document numbers
   (`encryptString`/`decryptString` in `packages/crypto`).
3. **AAD binds ciphertext to context**: canonical sorted-key JSON of
   `{tenantId, propertyId, submissionId, requirementVersion}`. This is defense in depth —
   even a tenant-filter bug in a query cannot decrypt another tenant's PDF. Never widen or
   loosen the AAD; changes to it require a versioned migration story.
4. **Tenant isolation by construction**: every owner query is `findFirst`/`findMany` with
   `tenantId: auth.tenantId` in the `where` — never a bare `findUnique({ id })`.
   Cross-tenant access returns 404, indistinguishable from nonexistent.
5. **Audit before you're done**: every sensitive action (submission created, PDF generated,
   viewed, downloaded, denied) writes an `AuditLog` row. A new sensitive endpoint without an
   audit event is incomplete. IP/user-agent are stored only as SHA-256 hashes.
6. **No PII in logs.** Request logs: method, redacted path, status, duration, request id.
   Audit `metadataJson`: counts, ids, key ids, error names only.
7. **Secrets are never committed.** `.env` is gitignored; `.env.example` holds placeholders.
   Production must refuse default/dev secrets (already enforced for `JWT_SECRET`).
8. **Registration tokens are stored only as SHA-256 hashes** (32 random bytes, base64url,
   raw value shown once at creation). Lookup failures are uniform 404s.
9. **RBAC**: OWNER/MANAGER may download PDFs; VIEWER gets metadata only (403 on download).
   Auth re-checks user + tenant status in the DB on every request; JWT is HS256, 12h,
   issuer/audience validated, algorithm pinned.
10. **`requirementVersion` travels with every submission and inside the AAD.** Current value
    `FI-ACCOMMODATION-2026-01` is a **legal placeholder** — verify against official Finnish
    sources before production. Requirement changes create a new version; old records stay
    interpretable.

## Architecture in one breath

`apps/{api,worker,web}` + `packages/{shared,db,crypto,pdf,queue,storage}`, scope `@gr/*`.
Dependency direction is strictly `apps → packages`. Packages export TS source directly
(`main: src/index.ts`, moduleResolution Bundler, run via tsx) — no backend build step.

The cloud seams are interfaces, and this is deliberate: `KmsProvider` (local AES-GCM master
key now → Azure Key Vault RSA-OAEP-256), `StorageProvider` (local filesystem → Azure Blob),
and the worker jobs take an explicit dependency bundle so they can move in-process → Service
Bus without rewriting job logic. **When adding infrastructure, extend the interface — never
let Azure SDK types leak into `apps/` or job logic.**

## Development methodology (what actually kept quality up)

- **Test the failure paths of crypto, not just the happy path.** The suite covers wrong-AAD,
  tampered ciphertext, tampered auth tag. Any new crypto surface needs the same treatment.
- **Verify end-to-end before claiming done.** The README's 10-step verify flow (seed → guest
  submit → PDF_READY → owner download decrypts → viewer 403 → audit row exists) is the
  definition of working. Run it, don't reason about it.
- **Uniform error discipline**: generic auth errors (`invalid_credentials` with constant-work
  bcrypt compare for unknown emails), uniform 404s for missing vs. forbidden, snake_case
  error codes.
- **Zod at every trust boundary** (schemas live in `packages/shared`, shared by web and api).
  Prefer `.strict()` on request schemas.
- **Docs are load-bearing.** `docs/{architecture,security,threat-model,data-model,api,
  retention-policy,mvp-plan}.md` are current and were written alongside the code. Update the
  relevant doc in the same change, or the next person (or agent) rebuilds context from zero.
- **One implementation.** Resist parallel rewrites; the legacy tree's deletion was the
  lesson. Improve in place behind the existing seams.

## Commands

```bash
docker compose up -d      # PostgreSQL 16 on host port 5433 (5432 is taken locally)
pnpm db:migrate && pnpm db:seed   # seed prints owner/viewer logins + registration URL once
pnpm dev                  # API :3000, web :5173
pnpm test                 # needs the docker DB up; test DB via prisma db push, fileParallelism off
pnpm typecheck && pnpm lint
pnpm --filter @gr/worker retention   # manual retention run
```

Gotchas: pnpm ≥ 9 via corepack; pnpm build approvals live in `pnpm-workspace.yaml`
(`allowBuilds`: prisma, esbuild).

## Known gaps toward production (in priority order)

- Azure wiring: Key Vault `KmsProvider`, Blob `StorageProvider`, Service Bus worker — the
  interfaces exist, the adapters don't.
- Verify the Finnish legal requirement version (placeholder, see invariant 10).
- JWT stored in localStorage on web; HS256 only (RS256/JWKS is the production path).
- Audit events for decrypt failures / unauthorized attempts.
- Request schemas not uniformly `.strict()`; PDF renderer drops non-Latin-1 glyphs to `?`.
- Field-level encryption currently covers document numbers only; names/DOB/addresses are
  plaintext columns (accepted trade-off for the dashboard — revisit deliberately).
