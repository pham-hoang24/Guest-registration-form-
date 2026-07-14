# Data Model

Source of truth: `packages/db/prisma/schema.prisma`. All IDs are UUIDs.

## Entities

- **Tenant** — the accommodation operator (billing/legal entity). Root of isolation.
- **OwnerUser** — dashboard user. `role` ∈ OWNER | MANAGER | VIEWER, `status` ∈ ACTIVE |
  DISABLED. Email globally unique; passwords bcrypt-hashed.
- **Property** — accommodation unit; address + optional Finnish `businessId` (Y-tunnus).
- **RegistrationLink** — carries `tokenHash` (SHA-256 hex of the raw URL token; the raw
  token is never stored), `status` ∈ ACTIVE | REVOKED | EXPIRED, optional `expiresAt`. A
  partial unique index (`registration_link_one_active_per_property`) enforces **at most one
  ACTIVE link per property**. The raw token is a secret capability URL shown exactly once.
- **GuestSubmission** — one stay (a "batch"), created with the active link. `status` ∈ OPEN |
  CLOSED | EXPIRED. Carries `requirementVersion`, `maxPassengerCards`,
  `retainUntil`/`deleteAfter`/`deletedAt`, `legalBasis`. `departureDate` is always required
  (both the owner-created link and the guest submission enforce it); `departureDateKnown` is
  a legacy column always persisted `true`. `purposeOfStay` is a required product rule (not a
  legal requirement — see `packages/shared/src/form-requirements/temPassengerCard.v1.ts`) and
  the `primaryGuest*` contact fields are null until the first card is submitted; contacts are
  wiped on retention purge.
- **PassengerCard** — one adult's card within a stay. `status` ∈ SUBMITTED | PDF_READY |
  FAILED. Holds `cardType`, `countryOfEntryToFinland` (+ `countryOfEntryNotApplicableReason`
  for `RESIDENT_IN_FINLAND`), and `submissionFingerprint` (HMAC-SHA256 over normalized card
  JSON, no plaintext credentials) unique per `(guestSubmissionId, submissionFingerprint)`.
- **Guest** — one person on a card. The card holder carries full detail; spouse/minor children
  are reduced rows. `documentNumberEncrypted` and `finnishPersonalIdentityCodeEncrypted` are
  envelope-encrypted JSON blobs (never plaintext); `dateOfBirth` is null on the PIC path.
  `citizenship` (field 4; displayed as **Nationality** in UI/PDF; full country name on the
  card) is always required for card holders — a Finnish personal identity code does not encode it. `isResidentInFinland` is an explicit required
  choice for every adult. `documentNumberNotApplicableReason` ∈ RESIDENT_IN_FINLAND |
  NORDIC_CITIZEN — exempt ONLY for residents or Nordic citizens; holding a Finnish personal
  identity code does NOT exempt the document number (field 6).
- **PassengerCardSignature** — one per card; `signatureEncrypted` (nullable so it can be wiped
  after embedding) + `signatureSha256`.
- **PdfJob** — one per card; `status` ∈ PENDING | PROCESSING | COMPLETED | FAILED.
- **EncryptedPdf** — **one per PassengerCard** (not per submission). Envelope-encryption
  metadata: `storageProvider`, `blobPath`, `encryptedDekBase64`, `ivBase64`, `authTagBase64`,
  `aadJson`, `kekKeyId`, `algorithm` (`AES-256-GCM`), `sha256Ciphertext`, plus `batchId`
  (= `guestSubmissionId`). Cascade-deleted with the card.
- **AuditLog** — append-only trail. `actorType` ∈ GUEST | OWNER | SYSTEM. Stores `ipHash`
  and `userAgentHash` (SHA-256), never raw values; `metadataJson` must be PII-free
  (counts/ids/key-ids/error-names only).

## Tenant scoping

`tenantId` is denormalized onto OwnerUser, Property, RegistrationLink, GuestSubmission,
PassengerCard, Guest, PassengerCardSignature, PdfJob, EncryptedPdf, and AuditLog. Every owner
query filters on `tenantId`; cross-tenant access returns 404.

## Indexes

- `RegistrationLink.tokenHash` unique (public link lookup); `(tenantId, propertyId)`;
  **partial unique** on `propertyId WHERE status = 'ACTIVE'` (one active link per property).
  This index is migration-only — the test DB re-applies it in `apps/api/tests/globalSetup.ts`
  after `prisma db push`, or the guarantee silently vanishes under test.
- `GuestSubmission (tenantId, propertyId)`, `(deleteAfter)`, `(deletedAt)` for retention.
- `PassengerCard (tenantId, propertyId)`, `(guestSubmissionId)`.
- `EncryptedPdf (tenantId)`, `(batchId)`.
- `AuditLog (tenantId, createdAt)` and `(action, createdAt)`.

## Blob path convention

`tenant/{tenantId}/property/{propertyId}/submission/{batchId}/card/{passengerCardId}.pdf.enc`
