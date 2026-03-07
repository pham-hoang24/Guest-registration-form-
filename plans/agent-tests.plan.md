# Tests Agent

## Goal

Write a comprehensive test suite covering: crypto primitives, AAD, ciphertext integrity, the worker end-to-end pipeline, the owner decrypt-and-stream route, and RBAC. Unit tests have no dependencies and can run immediately. Integration tests require the real SQL + blob adapters.

## Prerequisites

- Unit tests: None — run against in-memory adapters. Run in parallel with other agents.
- Integration tests: Require `agent-db-adapter`, `agent-storage-adapter`, `agent-queue-adapter` complete.

## Master plan reference

- [`production-readiness-master.plan.md`](production-readiness-master.plan.md)

## Existing tests (do not duplicate, do extend)

- `backend/tests/authz.test.ts` — property RBAC (allow/deny). Read before writing authz tests.
- `backend/tests/guestToken.test.ts` — jti replay protection. Read before writing token tests.

## Existing test infrastructure

- Framework: Vitest (`vitest run`)
- Mock KEK: `MockKekAdapter` in `backend/src/crypto/keyVaultKek.ts` — use this for all crypto tests
- In-memory DB: `InMemoryDb` + `db.reset()` in `beforeEach`
- In-memory storage: `InMemoryBlobStore` (or whatever the storage adapter agent names it)

## Test files to create

### `backend/tests/crypto/aesgcm.test.ts` — AES-256-GCM unit tests

```typescript
describe("AES-256-GCM", () => {
  it("round-trips correctly");
  it("fails with tampered AAD");       // change any AAD field → GCM tag fails
  it("fails with wrong DEK");          // different random DEK → decryption throws
  it("fails with truncated ciphertext"); // slice ciphertext → tag verification fails
  it("fails with flipped ciphertext bit"); // XOR one byte → throws
  it("rejects DEK shorter than 32 bytes"); // CryptoError
  it("rejects DEK longer than 32 bytes");  // CryptoError
  it("rejects nonce shorter than 12 bytes on decrypt"); // CryptoError
  it("rejects tag shorter than 16 bytes on decrypt");   // CryptoError
  it("generates unique nonces on each call"); // 100 calls → 100 unique nonces
});
```

### `backend/tests/crypto/aad.test.ts` — Canonical JSON AAD tests

```typescript
describe("buildAadBytes", () => {
  it("produces deterministic bytes regardless of input object key order");
  it("produces different bytes when tenantId changes");
  it("produces different bytes when propertyId changes");
  it("produces different bytes when submissionId changes");
  it("produces different bytes when templateVersion changes");
  it("produces different bytes when cryptoVersion changes");
  it("throws on undefined values");
  it("throws on non-finite numbers");
});

describe("buildPayloadAadBytes", () => {
  it("produces different bytes from buildAadBytes for same ids"); // purpose field differs
  it("deterministic output");
});

describe("canonicalizeJson", () => {
  it("sorts keys alphabetically");
  it("handles nested objects");
  it("handles arrays");
  it("rejects undefined");
});
```

### `backend/tests/crypto/hashes.test.ts` — Hash and integrity tests

```typescript
describe("hashNonceCiphertextTagHex", () => {
  it("returns consistent 64-char hex");
  it("changes when nonce changes");
  it("changes when ciphertext changes");
  it("changes when tag changes");
});

describe("assertHashMatch", () => {
  it("passes when hashes match");
  it("throws when hashes differ");
  it("uses timing-safe comparison"); // assertHashMatch should not early-exit on first diff byte
});

describe("sha256Hex", () => {
  it("produces known output for known input"); // sanity check against known SHA-256 vector
});
```

### `backend/tests/crypto/encryptedPdfRecord.test.ts` — Record validation

```typescript
describe("parseEncryptedPdfRecord", () => {
  it("accepts a valid complete record");
  it("rejects missing recordVersion");
  it("rejects wrong cryptoVersion");
  it("rejects wrong aadVersion");
  it("rejects missing submissionId");
  it("rejects missing templateId");
  it("rejects nonceB64 with wrong decoded length"); // must be 12 bytes
  it("rejects tagB64 with wrong decoded length");   // must be 16 bytes
  it("rejects missing wrappedDekB64");
  it("rejects ciphertextSha256Hex with length != 64");
  it("rejects contentLength <= 0");
  it("rejects contentType != application/pdf");
  it("rejects missing blobPath");
  it("rejects missing kekKeyId or kekKeyVersion");
});
```

### `backend/tests/worker/processSubmission.test.ts` — End-to-end worker pipeline

This is the most important test. Use `MockKekAdapter` + in-memory DB + in-memory storage.

```typescript
describe("processSubmissionJob", () => {
  beforeEach(() => {
    db.reset();
    setKekAdapterForTests(new MockKekAdapter("test-key-id", "v1"));
  });

  it("generates and stores an encrypted PDF for a valid submission", async () => {
    // 1. Create submission record in db with status PENDING_PDF
    // 2. Encrypt and store a payload
    // 3. Call processSubmissionJob({ submissionId })
    // 4. Assert submission.status === "READY"
    // 5. Assert EncryptedPdfRecord stored with all fields populated
    // 6. Assert blob stored at expected path
    // 7. Assert audit log contains pdf_ready event
  });

  it("decrypts the stored PDF back to valid bytes", async () => {
    // After processSubmissionJob succeeds:
    // 1. Get the EncryptedPdfRecord
    // 2. Get blob from storage
    // 3. Unwrap DEK with MockKekAdapter
    // 4. Build AAD from record fields
    // 5. Verify AAD hash matches record.aadSha256Hex
    // 6. Verify ciphertext hash matches record.ciphertextSha256Hex
    // 7. Decrypt → should produce valid PDF bytes (starts with %PDF-)
  });

  it("sets status FAILED when payload is missing", async () => {
    // Create submission but no encrypted payload
    // processSubmissionJob → status should be FAILED, lastError = "missing_payload"
  });

  it("sets status FAILED when payload decryption fails", async () => {
    // Create submission with corrupted payload
    // processSubmissionJob → status FAILED
  });

  it("is idempotent when submission is already READY", async () => {
    // Create READY submission
    // processSubmissionJob → no change, no duplicate records
  });

  it("skips when attempt count exceeds max", async () => {
    // Create FAILED submission with attemptCount >= maxAttempts
    // processSubmissionJob → returns early, no changes
  });

  it("verifies existing blob before re-processing", async () => {
    // Existing record with valid blob → processSubmissionJob marks READY without re-encrypting
  });
});
```

### `backend/tests/routes/owner.test.ts` — Owner PDF route

Use `supertest` + `MockKekAdapter` + in-memory DB + in-memory storage.

```typescript
describe("GET /v1/owner/submissions/:id/pdf", () => {
  it("returns 401 without Authorization header");
  it("returns 401 with invalid JWT");
  it("returns 403 when owner does not belong to the submission's property");
  it("returns 403 when tenantId in JWT does not match submission tenantId");
  it("returns 404 when submission does not exist");
  it("returns 404 when submission has no blob_path");
  it("returns 200 with PDF bytes when authorized and PDF ready", async () => {
    // Setup: create tenant, property, submission, encrypted record + blob
    // Assert: Content-Type: application/pdf
    // Assert: Content-Disposition: attachment; filename contains submissionId
    // Assert: body decrypts to valid PDF bytes
    // Assert: audit log contains download_succeeded
  });
  it("logs download_denied audit on 403");
  it("logs download_started and download_succeeded on success");
  it("logs decrypt_failed on tampered ciphertext");
  it("returns 413 when PDF exceeds MAX_PDF_BYTES");
});
```

Install `supertest` and types:
```bash
npm install --save-dev supertest @types/supertest
```

### `backend/tests/services/payloadEncryption.test.ts` — Payload encrypt/decrypt

```typescript
describe("encryptPayload / decryptPayload", () => {
  it("round-trips plaintext with MockKekAdapter");
  it("fails to decrypt with tampered ciphertext");
  it("fails to decrypt with wrong context (different submissionId in AAD)");
  it("fails when ciphertextSha256Hex does not match");
  it("stores a different DEK from the PDF DEK"); // separate call → different wrapped bytes
});
```

### `backend/tests/worker/rewrapDekJob.test.ts` — Rewrap job

```typescript
describe("rewrapRecord", () => {
  it("rewraps DEK when record matches old KEK");
  it("skips record already on new KEK version");
  it("skips record on a different old KEK");
  it("returns changed=false when skipped");
  it("returns changed=true when rewrapped");
});

describe("rewrapDekJob", () => {
  it("rewraps all matching records and returns counts");
  it("skips records already on new key");
  it("continues on per-record error and increments totalFailed");
  it("is idempotent when re-run with same new key");
  it("CAS conflict is not counted as failed");
});
```

### `backend/tests/services/authz.test.ts` — Extend existing

Add to `backend/tests/authz.test.ts`:
```typescript
it("denies when tenantId in JWT does not match submission tenantId");
it("denies when submission does not exist");
it("denies when propertyId is not in owner.propertyIds");
it("allows when owner has the exact propertyId");
```

## Non-negotiable constraints

- No test may use `OWNER_JWT_SECRET` or `GUEST_TOKEN_SECRET` from production env vars. Set them explicitly in `beforeEach`.
- `MockKekAdapter` must be used for all crypto tests — never `KeyVaultKekAdapter`.
- `db.reset()` in `beforeEach` for all tests that touch the in-memory DB.
- No test may send real HTTP requests to Azure services.
- Tests must be runnable with `vitest run` and no env vars set.

## Definition of done

- All test files listed above exist with assertions (not just `it.todo`).
- `vitest run` passes all tests.
- `processSubmission.test.ts` verifies the full crypto pipeline: encrypt → store → decrypt → verify PDF starts with `%PDF-`.
- `owner.test.ts` verifies 401, 403, 404, 200, and audit log entries.
- `aesgcm.test.ts` verifies tamper detection via AAD, wrong DEK, and bit-flip scenarios.
