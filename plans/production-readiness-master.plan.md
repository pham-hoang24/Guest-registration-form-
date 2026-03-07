# Production Readiness — Master Plan

## Context

The backend has a solid security foundation already implemented:
- AES-256-GCM per-submission DEK encryption (PDF + payload)
- RSA-OAEP-256 Key Vault KEK wrap/unwrap via `KeyVaultKekAdapter`
- Canonical JSON AAD with hash stored per record
- Ciphertext integrity: sha256(nonce ∥ ciphertext ∥ tag)
- Guest token one-time use (jti replay tracking)
- Property-scoped RBAC in `canReadSubmission`
- Typed audit log with correlation IDs
- Optimistic concurrency (version + compareAndSwap) on records
- DEK rewrap per-record logic (`rewrapRecord`) implemented

**What is missing:** Every stateful service is in-memory only. Nothing persists. No real SQL, no real blob storage, no real queue. The RLS policy is a comment placeholder. Tests exist only for authz and guest token replay.

## Agents and dependency order

```
[A] agent-sql-schema       ← No deps. Run first.
[B] agent-db-adapter       ← Requires [A]
[C] agent-storage-adapter  ← No deps. Run in parallel with [A]
[D] agent-queue-adapter    ← No deps. Run in parallel with [A]
[E] agent-rewrap-job       ← Requires [B]
[F] agent-tests            ← Unit tests: no deps. Integration tests: requires [B][C][D]
[G] agent-auth-oidc        ← No deps. Run in parallel (touches only middleware + env)
[H] agent-deploy           ← Requires [B][C][D][E][G]
```

Parallel batches:
- **Batch 1 (parallel):** A, C, D, G, F (unit tests only)
- **Batch 2 (sequential after A):** B
- **Batch 3 (after B):** E, F (integration tests)
- **Batch 4 (after all):** H

## Agent files

| File | Agent | Scope |
|---|---|---|
| `agent-sql-schema.plan.md` | SQL Schema | schema.sql + real rls.sql |
| `agent-db-adapter.plan.md` | DB Adapter | Replace InMemoryDb with mssql + RLS context |
| `agent-storage-adapter.plan.md` | Storage Adapter | Replace in-memory blob with Azure Blob Storage |
| `agent-queue-adapter.plan.md` | Queue Adapter | Replace in-memory queue with Azure Service Bus |
| `agent-rewrap-job.plan.md` | Rewrap Job | Complete rewrapDekJob with real DB iteration + CAS |
| `agent-tests.plan.md` | Tests | Crypto unit tests + end-to-end worker + owner route |
| `agent-auth-oidc.plan.md` | Auth OIDC | Swap HS256 to JWKS/OIDC for owner JWT |
| `agent-deploy.plan.md` | Deploy | Azure Container Apps, env vars, managed identity |

## Key files agents must NOT break

These are production-correct. Do not rewrite or simplify:
- `backend/src/crypto/aesgcm.ts` — AES-256-GCM impl
- `backend/src/crypto/aad.ts` — canonical JSON AAD
- `backend/src/crypto/hashes.ts` — ciphertext integrity
- `backend/src/crypto/keyVaultKek.ts` — Key Vault adapter + MockKekAdapter
- `backend/src/storage/encryptedPdfRecord.ts` — record type + validator
- `backend/src/worker/processSubmission.ts` — end-to-end crypto pipeline
- `backend/src/routes/owner.ts` — decrypt-and-stream with hash verification
- `backend/src/services/payloadEncryption.ts` — payload encrypt/decrypt

## Non-negotiable constraints (enforce in all agents)

1. No plaintext guest data written to disk or logged.
2. No plaintext DEK ever stored — only wrapped DEK (`wrappedDekB64`).
3. RLS SESSION_CONTEXT must be set from the verified JWT `tenantId`, never from user-controlled input.
4. Every SQL query on a tenant-scoped table must run after `sp_set_session_context`.
5. Audit log rows are append-only. No UPDATE or DELETE on `audit_logs`.
6. Blob paths follow the pattern: `tenant/{tenantId}/property/{propertyId}/submission/{submissionId}.pdf.enc`
7. Owner auth returns 401 for missing/invalid token; 403 for valid token with no property access.
