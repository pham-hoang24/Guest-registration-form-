# Integration Guide: PDF Crypto Worker

## AAD schema and versioning
- AAD is a canonical JSON blob (UTF-8, sorted keys, no whitespace).
- Schema v1 fields:
  - `aadVersion`: `"1"`
  - `tenantId`, `propertyId`, `submissionId`
  - `templateId`, `templateVersion`, `pdfSchemaVersion`
  - `cryptoVersion`
- AAD bytes are built with `buildAadBytes()` and hashed with SHA-256 (`aadSha256Hex`).

## Encrypted record contract (v1)
Stored metadata (`EncryptedPdfRecord`) includes:
- `recordVersion`, `cryptoVersion`, `aadVersion`
- Identifiers: `submissionId`, `tenantId`, `propertyId`
- Template: `templateId`, `templateVersion`, `pdfSchemaVersion`
- Storage: `blobPath`, `contentType`, `contentLength`
- Crypto: `nonceB64` (12 bytes), `tagB64` (16 bytes), `wrappedDekB64`
- KEK: `kekKeyId` (full kid), `kekKeyVersion`
- Hashes: `ciphertextSha256Hex = sha256(nonce||ciphertext||tag)`, optional `aadSha256Hex`
- State: `createdAt`, `status`, `attemptCount`, `lastError`

## Storage layout
- Blob storage holds **ciphertext only** (no metadata).
- DB stores `EncryptedPdfRecord` metadata + blob path.
- `contentLength` is the **plaintext PDF length** for size guards.

## Key Vault KEK requirements
- KEK must be an **RSA key** compatible with `RSA-OAEP-256`.
- Environment:
  - `KEYVAULT_URL`
  - `KEK_KEY_NAME`
  - optional `KEK_KEY_VERSION` (pinning)
- Managed identity via `DefaultAzureCredential` is required.
- Persist the returned full `kid` for each wrap.

## Max PDF size
- `MAX_PDF_BYTES` enforces a hard cap during download.
- Default is 10MB if unset.
- Decrypt is in-memory for MVP. For large PDFs, add streaming decrypt + range support.

## PDF fonts (Unicode)
- For full Unicode support, provide a font:
  - `PDF_FONT_PATH` (absolute/relative path to a TTF/OTF)
  - or `PDF_FONT_BASE64` (base64-encoded font bytes)
- If Unicode content is detected and no font is configured, PDF generation fails closed.

## Rotation / rewrap
- `rewrapDekJob` unwraps using the **old** KEK and rewraps using the **new** KEK.
- Only KEK metadata + `wrappedDekB64` changes; ciphertext stays unchanged.
- Use optimistic concurrency / row version checks when updating records.

## Failure modes
- AAD/hash mismatches or unwrap/decrypt failures are **fail-closed**.
- Client receives generic errors (`decrypt_failed`, `pdf_too_large`); details stay in audit logs.
