---
name: pdf-crypto-worker
overview: Replace placeholder PDF/crypto/key vault logic with production-grade PDF generation, versioned AAD schema + AES-256-GCM, Key Vault KEK wrap/unwrap, idempotent worker flow, and tests/docs.
todos:
  - id: pdf-registry
    content: Implement pdf registry + default template with pdf-lib
    status: pending
  - id: crypto-aad
    content: Add versioned AAD schema + AES-GCM + hashes module
    status: pending
  - id: kek-adapter
    content: Implement Key Vault wrap/unwrap adapter + mock
    status: pending
  - id: record-contract
    content: Create EncryptedPdfRecord v1 + validation + DB storage
    status: pending
  - id: worker-flow
    content: Refactor worker + owner decrypt flow to new pipeline
    status: pending
  - id: tests-docs
    content: Add tests + integration guide
    status: pending
isProject: false
---

# Plan

## Scope and approach

- Integrate into existing backend layout under `backend/src`, updating current services and worker to use the new PDF + crypto pipeline rather than adding parallel modules.
- Add new modules for `pdf`, `crypto`, and `storage` contracts where required, and refactor existing `services/pdf.ts`, `services/crypto.ts`, and `services/keyVault.ts` to delegate or be replaced.
- Keep in-memory DB/storage behavior, but extend metadata storage to the new `EncryptedPdfRecord` v1 contract with explicit crypto metadata (nonce/tag/sha).

## Implementation steps

- Add `pdf-lib` dependency, then implement PDF template registry + default template in `[backend/src/pdf]` and update `backend/src/services/pdf.ts` to call the registry and return `{ pdfBytes, contentType, contentLength, template metadata }`.
- Implement versioned AAD schema + canonical JSON builder in `[backend/src/crypto/aad.ts]`, and AES-256-GCM encrypt/decrypt in `[backend/src/crypto/aesgcm.ts]` with clear hashing rules in `[backend/src/crypto/hashes.ts]`.
- Ensure AAD binds `tenantId`, `propertyId`, `submissionId`, `templateId`, `pdfSchemaVersion`, and `cryptoVersion`; build `buildAadBytes(input)` with deterministic ordering.
- Implement Azure Key Vault KEK adapter in `[backend/src/crypto/keyVaultKek.ts]` using `@azure/keyvault-keys` and `@azure/identity`, pin wrap algorithm (RSA-OAEP-256), persist full `kid`, and provide a mockable interface.
- Create `EncryptedPdfRecord` v1 type + validation + deterministic serialization in `[backend/src/storage/encryptedPdfRecord.ts]`, and extend DB layer `[backend/src/services/db.ts]` to store/retrieve records atomically.
- Refactor worker flow in `[backend/src/worker/index.ts]` (or new `[backend/src/worker/processSubmission.ts]`) with explicit idempotency, retries, and status transitions; store ciphertext separately from metadata.
- Update owner download flow in `[backend/src/routes/owner.ts]` to enforce max PDF size, validate hashes, unwrap DEK, and fail closed without leaking sensitive errors.
- Add KEK rotation scaffold `[backend/src/worker/rewrapDekJob.ts]` with core rewrap logic, idempotency guard, and TODOs for DB iteration.
- Add tests under `[backend/tests]` for AAD canonicalization stability, encrypt/decrypt roundtrip, tamper cases (AAD/tag/hash/nonce), Key Vault mock interaction, and worker idempotency.
- Write a short integration guide in `[backend/INTEGRATION_GUIDE.md]` covering storage split, env vars, and security notes.

## Files to review/update

- `[backend/src/services/pdf.ts](backend/src/services/pdf.ts)`
- `[backend/src/services/crypto.ts](backend/src/services/crypto.ts)`
- `[backend/src/services/keyVault.ts](backend/src/services/keyVault.ts)`
- `[backend/src/worker/index.ts](backend/src/worker/index.ts)`
- `[backend/src/routes/owner.ts](backend/src/routes/owner.ts)`
- `[backend/src/services/db.ts](backend/src/services/db.ts)`
- New: `[backend/src/pdf/*](backend/src/pdf/)`, `[backend/src/crypto/*](backend/src/crypto/)`, `[backend/src/storage/encryptedPdfRecord.ts](backend/src/storage/encryptedPdfRecord.ts)`, `[backend/src/worker/rewrapDekJob.ts](backend/src/worker/rewrapDekJob.ts)`
- Tests: `[backend/tests/*](backend/tests/)`

## Notes / assumptions

- Blob storage remains in-memory mock; ciphertext bytes stored separately from metadata, with `ciphertextSha256 = sha256(nonce||ciphertext||tag)` documented and enforced.
- If any existing DB or schema files conflict, I’ll report and adapt.
