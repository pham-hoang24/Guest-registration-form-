# PDF Generation

How a signed passenger card becomes an encrypted PDF, and the rules the layout must obey.

## Status: reference template, legal review pending

The worker fills the official TEM AcroForm template (`packages/pdf/templates/passenger-card.pdf`,
copied from `Matkustajailmoitusmalli.pdf`) as a **reference asset only — draft / not legally
approved** until Tier 4 licensing and legal sign-off (CLAUDE.md invariant 10). Nothing here asserts
the form is authority-ready or legally compliant.

The active form requirement version (`packages/shared/src/form-requirements/temPassengerCard.v1.ts`,
`FI-TEM-PASSENGER-CARD-2026-DRAFT-V1`) ships with `reviewStatus: LEGAL_REVIEW_PENDING`.

Production **fails closed**: `configFromEnv` refuses to start when the active requirement version
is not `LEGAL_APPROVED`, unless `REQUIRE_LEGAL_APPROVED_REQUIREMENTS=false` is set deliberately.
The flag defaults to `true` in production.

The legacy draft renderer (`packages/pdf/src/registrationPdf.ts`) remains for unit tests only; the
worker uses `generatePassengerCardPdf` (`packages/pdf/src/passengerCardPdf.ts`).

## Pipeline

1. Worker `generatePdfForPassengerCard` (`apps/worker/src/generatePdfForPassengerCard.ts`) loads one
   `PassengerCard`, its guests, and its signature; decrypts the signature (and any document number)
   in memory only.
2. It projects the card to a data object and calls `generatePassengerCardPdf`
   (`packages/pdf/src/passengerCardPdf.ts`).
3. `mapCardToTemFields` (`packages/pdf/src/temFieldMap.ts`) turns that object into numbered TEM
   fields. This is a **pure, unit-tested projection** — the blank/full-name rules are testable
   independently of AcroForm filling (`packages/pdf/tests/temFieldMap.test.ts`).
4. The generator loads the bundled template, fills AcroForm fields via `pdf-lib`, runs
   `assertMinimizationInvariants` (fail closed), updates field appearances with the bundled DejaVu
   Sans font, trims and overlays the transparent signature PNG within a verified safe zone,
   flattens the form, and produces PDF bytes **in memory**.
5. Those bytes are AES-256-GCM encrypted with a fresh DEK, the DEK is wrapped by `KmsProvider`, and
   only ciphertext + wrapped DEK reach storage/DB (invariants 1–3). The AAD binds
   `{tenantId, propertyId, submissionId, requirementVersion}` plus the passenger-card id.

Invariant 1 is regression-tested: the stored blob must **not** begin with `%PDF-`
(`apps/worker/tests/generatePdfForPassengerCard.test.ts`).

## AcroForm field map

| Template field | TEM field | Source |
|---|---|---|
| `Text1`–`Text6` | 1–6 | Card holder surname, given names, PIC/DOB, nationality, address, passport/ID |
| `A1.i`, `A2.i`, `A3.i` | 7–9 | Accompanying person *i* surname, given names, PIC/DOB |
| `Text7`, `Text8` | 10–11 | Arrival, departure |
| `Text8b` | 12 | Country of entry (blank when resident in Finland) |
| `Check Box1`–`4` | 13 | Purpose: Leisure / Business / Meeting / Other |
| *(overlay)* | 16 | Signature PNG (transparent, trimmed, centered in safe zone) |
| `Check Box5` | — | **Never ticked** — sits beside the marketing-prohibition notice on the template, not a consent field |
| `Text9`–`Text11` | 17–19 | Provider name, business ID, visiting address |

Template field names are verified by `packages/pdf/tests/passengerCardTemplate.test.ts`.

## One PDF per adult card

Each adult produces one `PassengerCard` → one PDF. A spouse and minor children **ride on the
primary holder's card** as reduced rows (surname / given names / PIC-or-DOB only), numbered from
field 7. The card holder is the only person carrying the full detail set.

## Field mapping and data minimization

`mapCardToTemFields` projects only these fields:

- **Holder (1–6):** surname, given names, PIC-or-DOB, nationality (**full country name**, not the
  ISO code; stored internally as `citizenship`), address, passport/ID number.
- **Family riders (7+):** surname, given names, PIC-or-DOB only.
- **Entry & stay (12–15):** country of entry (**full name**), arrival, departure, purpose.
- **Signature (16):** the decoded PNG image (overlaid; no AcroForm field).
- **Provider (17–19):** name, business id, address (**full country name**).

Conditional blanks (present but empty — the box stays on the card):

- **Field 6 (passport / ID no.)** is blank ONLY when the holder is **resident in Finland** or a
  **Nordic citizen** (TEM footnote 1). Nationality alone does not blank field 6 — a non-resident,
  non-Nordic holder with Afghan (or any non-Nordic) nationality must still have a document number.
- **Field 12 (country of entry)** is blank when the holder is **resident in Finland**
  (`isResidentInFinland === true` or reason `RESIDENT_IN_FINLAND`). Nordic citizenship does **not**
  blank it — only residency does.
- **Departure** is always required and always rendered (no "unknown departure" state).

**Never rendered on the PDF:** email, phone, `countryOfResidence`, `documentType`, internal
not-applicable reason codes, and any token/audit data. These are excluded *by construction* — the
`RegistrationCardPdfInput` type does not carry them — and a test asserts none appear in the
serialized field output.

## Signature overlay

- Guest signatures are captured with a **transparent** PNG backing (`SignatureField.tsx`); only
  strokes are opaque.
- Before embedding, `trimTransparentPadding` (`packages/pdf/src/signatureImage.ts`) crops
  transparent margins.
- The image is scaled to at most 85% of the safe-zone width and 65% of its height, centered
  vertically within `SIGNATURE_SAFE_ZONE` (`x: 60, y: 160, width: 240, height: 36`), verified
  against the template via `pdftotext -bbox`. The zone sits between the provider-section header
  (~y 157.5) and the signature-label line (~y 198.7) and must not overlap the marketing-prohibition
  notice or provider fields.

## Render validation

Before any field is written, `assertMinimizationInvariants` throws if field 6 or field 12 would be
blank for a holder who is not allowed to omit them. The worker marks the card `FAILED` and writes
`PDF_GENERATION_FAILED` — fail closed rather than ship a non-conforming document (CLAUDE.md
invariant 10).

Automated tests (`packages/pdf/tests/passengerCardPdf.test.ts`) enforce:

- `Check Box5` is never ticked; only one purpose checkbox (1–4) is checked.
- Signature placement stays inside `SIGNATURE_SAFE_ZONE`.
- Non-resident, non-Nordic holders cannot render with blank field 6 or field 12.

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
