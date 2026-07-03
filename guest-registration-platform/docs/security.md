# Security

## Encryption of registration PDFs

- **Base64 is encoding, not encryption.** Base64 fields in `EncryptedPdf`
  (`encryptedDekBase64`, `ivBase64`, `authTagBase64`) are transport encodings of binary
  values that are themselves outputs of real cryptography.
- PDF bytes are encrypted with **AES-256-GCM**.
- **One fresh random 32-byte DEK and one fresh random 12-byte IV per PDF.** Keys are never
  reused across documents; the DEK buffer is zeroed after wrapping.
- **The DEK is wrapped by the KMS provider** (`KmsProvider.wrapKey`). Locally this is
  AES-256-GCM under a master key from `.env`; in production it must be Azure Key Vault
  (RSA-OAEP-256). Only the wrapped DEK is persisted.
- **AAD binds the ciphertext to `tenantId`, `propertyId`, `submissionId`, and
  `requirementVersion`** (canonical sorted-key JSON). GCM authenticates the AAD, so a
  ciphertext or record moved to another submission/tenant fails decryption. Tests cover
  wrong-AAD, tampered ciphertext, and tampered auth tag.
- `sha256Ciphertext` is stored and re-verified before every decrypt (fast integrity check
  before touching the KMS).
- **Plaintext PDFs are never stored** — not on disk, not in the database, not in logs. They
  exist in memory during generation/encryption and decryption/streaming only. Downloads are
  served with `cache-control: no-store`.
- **Every PDF download is audit logged** (`OWNER_DOWNLOADED_PDF`, with actor id and hashed
  IP/user agent), as is every submission view.

Guest **document numbers** get the same envelope treatment (per-value DEK, AAD bound to
submission + field name) via `encryptString`/`decryptString`.

Known limitation: other guest fields (names, birth dates, addresses, contact email/phone)
are plaintext columns so the dashboard can display them. Field-level encryption for those is
a candidate hardening step.

## Authentication and authorization

- Owner passwords: bcrypt cost 12. Login errors are generic (`invalid_credentials`) and a
  constant-work bcrypt compare runs even for unknown emails.
- JWT: HS256, 12h expiry, issuer + audience validated, algorithm pinned. Every request
  re-checks user + tenant status in the database.
- RBAC: OWNER and MANAGER may download PDFs; VIEWER sees metadata only (403 on download).
- Tenant isolation: all owner queries filter by `tenantId`; cross-tenant access returns 404.

## Registration links

Tokens are 32 random bytes (base64url). Only SHA-256 hashes are stored; the seed script
prints the raw URL once. Lookup failures are uniform 404s.

## Logging discipline

Request logs contain method, redacted path, status, duration, request id — never bodies,
headers, or query strings. Audit `metadataJson` is limited to non-PII values (counts, ids,
key ids, error names). IP and user agent are stored only as SHA-256 hashes.

## Secrets

`.env` is gitignored; `.env.example` contains placeholders only. `JWT_SECRET` and
`LOCAL_KMS_MASTER_KEY_BASE64` are development values — production requires a secret manager
(Azure Key Vault) and startup refuses a default JWT secret when `NODE_ENV=production`.
