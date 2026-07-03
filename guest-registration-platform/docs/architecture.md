# Architecture

## Overview

A multi-tenant compliance record system for accommodation providers in Finland. Guests submit
registration details through a unique link; the backend produces an authority-ready PDF,
encrypts it with envelope encryption, and stores only ciphertext. Property owners access
submissions and decrypted PDFs through an audited, role-gated dashboard.

## Monorepo layout

```
apps/
  api/      Express HTTP API (public guest routes + owner routes)
  worker/   Jobs: PDF generation, retention cleanup (in-process for MVP)
  web/      React SPA (guest form + owner dashboard)
packages/
  shared/   Zod schemas + constants used by web and api
  db/       Prisma schema, client singleton, audit writer, seed script
  crypto/   KMS abstraction, envelope encryption, token hashing
  pdf/      pdf-lib PDF renderer (pure function, in-memory only)
  storage/  StorageProvider abstraction + local filesystem provider
```

Dependency direction: `apps → packages`. `@gr/api` calls `@gr/worker` in-process for the MVP;
the job module takes an explicit dependency bundle so it can move behind Azure Service Bus
without rewriting job logic.

## Request flows

### Guest submission
1. `GET /v1/public/registration-links/:token` — token is SHA-256-hashed and looked up;
   only safe property info is returned.
2. `POST .../submissions` — Zod validation → submission + guest rows created (document
   numbers envelope-encrypted before insert) → audit `GUEST_REGISTRATION_SUBMITTED` →
   PDF job runs: generate → AES-256-GCM encrypt (fresh DEK + IV, AAD binds
   tenant/property/submission/requirementVersion) → DEK wrapped by KMS → ciphertext to
   storage → `EncryptedPdf` row → status `PDF_READY` → audit `PDF_GENERATED`.

### Owner download
JWT auth → DB re-check of user/tenant status → tenant-scoped submission fetch → RBAC
(OWNER/MANAGER only) → blob fetched → ciphertext sha256 verified → AAD rebuilt from the row
and compared → DEK unwrapped → decrypt → streamed to client with `no-store` → audit
`OWNER_DOWNLOADED_PDF`.

## Multi-tenancy

Every owner-facing table carries `tenantId`. All owner queries are `findFirst`/`findMany`
with `tenantId: auth.tenantId` in the `where` — never a bare `findUnique({ id })`.
Cross-tenant lookups return 404 (indistinguishable from nonexistent). Defense in depth: the
encryption AAD also binds ciphertext to its tenant, so even a query bug cannot decrypt
another tenant's PDF under the wrong context.

## Extension points

- `KmsProvider` (packages/crypto) → Azure Key Vault wrap/unwrap (RSA-OAEP-256).
- `StorageProvider` (packages/storage) → Azure Blob Storage.
- `apps/worker` job entry points → Azure Service Bus consumers.
- `requirementVersion` on every submission and inside the AAD → future Finnish requirement
  changes create a new version; old records remain interpretable.

## Local development

Docker Compose runs PostgreSQL 16 on host port **5433** (5432 is commonly occupied). A
second database `guest_registration_test` is created by an init script and used by the
Vitest suites in `apps/api` and `apps/worker` (schema pushed via `prisma db push` in
global setup, tables truncated between tests).
