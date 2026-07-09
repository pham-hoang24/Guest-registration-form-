# PDF Generation

How a signed passenger card becomes an encrypted PDF, and the rules the layout must obey.

## Status: DRAFT template, legal review pending

Tier 3 renders a **draft** passenger card that follows the TEM passenger-card field model. The
active form requirement version (`packages/shared/src/form-requirements/temPassengerCard.v1.ts`,
`FI-TEM-PASSENGER-CARD-2026-DRAFT-V1`) ships with `reviewStatus: LEGAL_REVIEW_PENDING`. This is a
**placeholder pending human legal sign-off** (CLAUDE.md invariant 10) — nothing here asserts the
form is official, authority-ready, or legally compliant.

- The rendered PDF carries a visible `DRAFT — generated from a configured template; legal review
  pending.` banner.
- The **official TEM PDF asset is not shipped**. If a real TEM PDF is ever committed for reference,
  it must be marked *draft / reference only, not legally approved* (Tier 4 confirms licensing /
  right-to-use).
- Production **fails closed**: `configFromEnv` refuses to start when the active requirement version
  is not `LEGAL_APPROVED`, unless `REQUIRE_LEGAL_APPROVED_REQUIREMENTS=false` is set deliberately.
  The flag defaults to `true` in production.

## Pipeline

1. Worker `generatePdfForPassengerCard` (`apps/worker/src/generatePdfForPassengerCard.ts`) loads one
   `PassengerCard`, its guests, and its signature; decrypts the signature (and any document number)
   in memory only.
2. It projects the card to a data object and calls `generateRegistrationPdf`
   (`packages/pdf/src/registrationPdf.ts`).
3. `mapCardToTemFields` (`packages/pdf/src/temFieldMap.ts`) turns that object into numbered TEM
   fields. This is a **pure, unit-tested projection** — the blank/full-name rules are testable
   independently of pdf-lib layout (`packages/pdf/tests/temFieldMap.test.ts`).
4. The layer renders text + signature image with the bundled DejaVu font (Vietnamese + Nordic
   glyphs survive; no `?` substitution), producing PDF bytes **in memory**.
5. Those bytes are AES-256-GCM encrypted with a fresh DEK, the DEK is wrapped by `KmsProvider`, and
   only ciphertext + wrapped DEK reach storage/DB (invariants 1–3). The AAD binds
   `{tenantId, propertyId, submissionId, requirementVersion}` plus the passenger-card id.

Invariant 1 is regression-tested: the stored blob must **not** begin with `%PDF-`
(`apps/worker/tests/generatePdfForPassengerCard.test.ts`).

## One PDF per adult card

Each adult produces one `PassengerCard` → one PDF. A spouse and minor children **ride on the
primary holder's card** as reduced rows (surname / given names / PIC-or-DOB only), numbered from
field 7. The card holder is the only person carrying the full detail set.

## Field mapping and data minimization

`mapCardToTemFields` projects only these fields:

- **Holder (1–6):** surname, given names, PIC-or-DOB, nationality (**full country name**, not the
  ISO code), address, passport/ID number.
- **Family riders (7+):** surname, given names, PIC-or-DOB only.
- **Entry & stay (12–15):** country of entry (**full name**), arrival, departure, purpose.
- **Signature (16):** the decoded PNG image + signed-at timestamp.
- **Provider (17–19):** name, business id, address (**full country name**).

Conditional blanks (present but empty — the box stays on the card):

- **Field 6 (passport / ID no.)** is blank when the holder has no document number (e.g. a
  Nordic citizen who was not required to give one).
- **Field 12 (country of entry)** is blank when the holder is resident in Finland
  (`isResidentInFinland === true` or reason `RESIDENT_IN_FINLAND`). Nordic citizenship does **not**
  blank it — only residency does.
- **Departure** is blank when the departure date is not known.

**Never rendered on the PDF:** email, phone, `countryOfResidence`, `documentType`, internal
not-applicable reason codes, and any token/audit data. These are excluded *by construction* — the
`RegistrationCardPdfInput` type does not carry them — and a test asserts none appear in the
serialized field output.

## Product rules (not legal claims)

- **Purpose of stay is mandatory** as a product rule set by the first guest card, not as a legal
  assertion. The owner never sets it.
- Passenger-card data is collected **only** to meet the accommodation registration obligation. It is
  **not** used for customer service or direct marketing.
- Only the four holder-identity fields plus provider details leave the card; everything else is
  minimized away before rendering.

## See also

- `docs/data-model.md` — `PassengerCard`, `Guest`, `EncryptedPdf`, requirement versions.
- `docs/architecture.md` — the `KmsProvider` / `StorageProvider` seams and the worker bundle.
- CLAUDE.md invariants 1–3 (envelope encryption, AAD) and 10 (legal placeholder).
