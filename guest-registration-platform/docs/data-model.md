# Data Model

Source of truth: `packages/db/prisma/schema.prisma`. All IDs are UUIDs.

## Entities

- **Tenant** — the accommodation operator (billing/legal entity). Root of isolation.
- **OwnerUser** — dashboard user. `role` ∈ OWNER | MANAGER | VIEWER, `status` ∈ ACTIVE |
  DISABLED. Email globally unique; passwords bcrypt-hashed.
- **Property** — accommodation unit; address + optional Finnish `businessId` (Y-tunnus).
- **RegistrationLink** — carries `tokenHash` (SHA-256 hex of the raw URL token; the raw
  token is never stored), `status` ∈ ACTIVE | DISABLED | EXPIRED, optional `expiresAt`.
- **GuestSubmission** — one stay registration. Carries `requirementVersion`
  (compliance versioning), `retainUntil`, `deleteAfter`, `legalBasis` (retention design),
  nullable `guestEmail`/`guestPhone` so retention can clear them, and
  `status` ∈ RECEIVED | PDF_READY | FAILED | DELETED.
- **Guest** — one person on a submission. `documentNumberEncrypted` is an
  envelope-encrypted JSON blob (never plaintext). Rows are deleted entirely by retention.
- **EncryptedPdf** — envelope-encryption metadata for the stored ciphertext:
  `storageProvider`, `blobPath`, `encryptedDekBase64`, `ivBase64`, `authTagBase64`,
  `aadJson`, `kekKeyId`, `algorithm` (`AES-256-GCM`), `sha256Ciphertext`. 1:1 with
  submission, cascade-deleted.
- **AuditLog** — append-only trail. `actorType` ∈ GUEST | OWNER | SYSTEM. Stores `ipHash`
  and `userAgentHash` (SHA-256), never raw values; `metadataJson` must be PII-free.

## Tenant scoping

`tenantId` exists on OwnerUser, Property, RegistrationLink, GuestSubmission, EncryptedPdf,
and AuditLog. `Guest` is scoped transitively through its submission and only ever loaded
via a tenant-scoped submission query.

## Indexes

- `RegistrationLink.tokenHash` unique (login-path lookup).
- `GuestSubmission (tenantId, propertyId)` for dashboard lists;
  `(deleteAfter, status)` for the retention sweep.
- `AuditLog (tenantId, createdAt)` and `(action, createdAt)`.

## Blob path convention

`tenant/{tenantId}/property/{propertyId}/submission/{submissionId}.pdf.enc`
