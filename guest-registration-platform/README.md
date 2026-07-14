# Guest Registration Platform

Multi-tenant digital guest registration for accommodation providers in Finland. Guests fill
a mobile-first form via a unique link; the backend produces an authority-ready PDF encrypted
with envelope encryption (AES-256-GCM, per-PDF DEK, KMS-wrapped). Owners view submissions
and download decrypted PDFs through an audited, role-gated dashboard.

> **Legal note:** the requirement version `FI-ACCOMMODATION-2026-01` is a placeholder.
> Finnish accommodation registration requirements must be verified against official sources
> before production use. See `docs/retention-policy.md` and `docs/mvp-plan.md`.

## Prerequisites

- Node.js ≥ 20, pnpm ≥ 9 (`corepack enable pnpm`)
- Docker (for PostgreSQL; runs on host port **5433**)

## Quick start

```bash
pnpm install
cp .env.example .env
# set LOCAL_KMS_MASTER_KEY_BASE64 in .env:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

docker compose up -d      # PostgreSQL + Redis only (host port 5433)
pnpm db:migrate           # prisma migrate dev
pnpm db:seed              # prints owner/viewer logins + registration URL
pnpm dev                  # API on :3000, web on :5173
```

> **Do not run the full Docker stack (`docker compose --profile full up -d`) at the
> same time as `pnpm dev`** — both bind port 3000. The default `docker compose up -d`
> starts only Postgres and Redis; use `pnpm dev` for the API and web with live reload.

## Verify the end-to-end flow

1. Open the registration URL printed by the seed (raw token is shown once; only its hash is stored).
2. Submit a guest registration.
3. Submission is created (`201 { submissionId, status: "RECEIVED" }`).
4. Encrypted PDF is generated (submission becomes `PDF_READY`; blob under
   `apps/api/.local-storage/...pdf.enc` is ciphertext).
5. Log in at `/owner/login` as `owner@example.com` / `owner-dev-password`.
6. Open the property → submissions list.
7. Open the submission and download the decrypted PDF.
8. Audit log contains `OWNER_DOWNLOADED_PDF`
   (`docker compose exec postgres psql -U postgres -d guest_registration -c 'SELECT action FROM "AuditLog"'`).
9. Log in as `viewer@example.com` / `viewer-dev-password`.
10. The viewer sees metadata but the PDF download is denied (403).

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Run API + web in watch mode |
| `pnpm test` | All test suites (needs `docker compose up -d`) |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm db:migrate` / `pnpm db:seed` | Prisma migrate / seed |
| `pnpm --filter @gr/worker retention` | Run retention cleanup manually |

## Documentation

`docs/architecture.md` · `docs/threat-model.md` · `docs/api.md` · `docs/data-model.md` ·
`docs/security.md` · `docs/retention-policy.md` · `docs/mvp-plan.md`

## Security highlights

- Envelope encryption per PDF: fresh 32-byte DEK + 12-byte IV, AES-256-GCM, AAD binding
  tenant/property/submission/requirementVersion, DEK wrapped via the `KmsProvider` interface
  (local AES-GCM master key for dev; Azure Key Vault intended for production).
- Registration tokens: 256-bit random, stored only as SHA-256 hashes.
- Plaintext PDFs never touch disk; guest document numbers are envelope-encrypted in the DB.
- Every owner query is tenant-scoped; RBAC gates PDF downloads; all sensitive actions are
  audit logged with hashed IP/user-agent and no raw PII.
