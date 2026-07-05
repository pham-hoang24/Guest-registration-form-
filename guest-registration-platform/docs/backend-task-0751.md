 Guest Registration — Legal Passenger-Card Model + Official PDF Filling

 Context

 Today one digital form submission is stored as a single GuestSubmission with a flat
 Guest[] list and produces one PDF. This is legally wrong for the Finnish
 accommodation regime: the legal record is the passenger card (matkustajailmoitus),
 one per required adult. A spouse and minor children ride along on the primary guest's
 card; every additional adult needs their own card and their own PDF.

 This change reshapes storage and PDF generation to the correct legal model, and produces
 each card's PDF by filling the official TEM template
 /Users/phamhoang/Downloads/Matkustajailmoitusmalli.pdf (AcroForm) rather than drawing a
 document from scratch.

 Final rule:
 1 digital form submission      = 1 RegistrationBatch
 1 required passenger card      = 1 PassengerCard = 1 encrypted PDF
 1 additional adult             = 1 separate PassengerCard
 spouse + minor children        = attached to the primary PassengerCard (no own card/PDF)

 Scope for this task: backend + worker + PDF package + tests only. The React form,
 i18n, and owner UI are a follow-up (API stays contract-driven so the frontend can
 catch up later). GuestSubmission/Guest/EncryptedPdf remain as read-only legacy
 compatibility models — no new writes, no double-writing; PassengerCard is the single
 source of truth for every new PDF.

 ---
 Official template field map (verified against the PDF)

 Matkustajailmoitusmalli.pdf — 1 page, A4, 32 AcroForm fields. Card-holder = the primary
 or additional-adult who owns the card. All coordinates verified via pdf-lib.

 ┌────────────────┬────────────────────────────────────┬───────────────────────────────────────────────────┐
 │ Template field │              Meaning               │                      Source                       │
 ├────────────────┼────────────────────────────────────┼───────────────────────────────────────────────────┤
 │ Text1          │ 1. Surname                         │ cardHolder.lastName                               │
 ├────────────────┼────────────────────────────────────┼───────────────────────────────────────────────────┤
 │ Text2          │ 2. Given names                     │ cardHolder.firstName                              │
 ├────────────────┼────────────────────────────────────┼───────────────────────────────────────────────────┤
 │ Text3          │ 3. Henkilötunnus/Syntymäaika       │ cardHolder.dateOfBirth                            │
 ├────────────────┼────────────────────────────────────┼───────────────────────────────────────────────────┤
 │ Text4          │ 4. Nationality                     │ cardHolder.citizenship                            │
 ├────────────────┼────────────────────────────────────┼───────────────────────────────────────────────────┤
 │ Text5          │ 5. Address                         │ cardHolder.address                                │
 ├────────────────┼────────────────────────────────────┼───────────────────────────────────────────────────┤
 │ Text6          │ 6. Passport/ID number              │ ${documentType} ${documentNumber} (decrypted)     │
 ├────────────────┼────────────────────────────────────┼───────────────────────────────────────────────────┤
 │ A1.0..A1.4     │ 7. Surname (accompanying 1..5)     │ attachedPeople[i].lastName                        │
 ├────────────────┼────────────────────────────────────┼───────────────────────────────────────────────────┤
 │ A2.0..A2.4     │ 8. Given names (accompanying 1..5) │ attachedPeople[i].firstName                       │
 ├────────────────┼────────────────────────────────────┼───────────────────────────────────────────────────┤
 │ A3.0..A3.4     │ 9. DOB (accompanying 1..5)         │ attachedPeople[i].dateOfBirth                     │
 ├────────────────┼────────────────────────────────────┼───────────────────────────────────────────────────┤
 │ Text7          │ 10. Date of arrival                │ arrivalDate                                       │
 ├────────────────┼────────────────────────────────────┼───────────────────────────────────────────────────┤
 │ Text8          │ 11. Date of departure              │ departureDate                                     │
 ├────────────────┼────────────────────────────────────┼───────────────────────────────────────────────────┤
 │ Text8b         │ 12. Country of entry to Finland    │ countryOfEntryToFinland                           │
 ├────────────────┼────────────────────────────────────┼───────────────────────────────────────────────────┤
 │ Check Box1..4  │ 13. Purpose of stay                │ Leisure / Business / Meeting / Other → tick match │
 ├────────────────┼────────────────────────────────────┼───────────────────────────────────────────────────┤
 │ Check Box5     │ consent/confirm box                │ tick (guest confirmed accuracy)                   │
 ├────────────────┼────────────────────────────────────┼───────────────────────────────────────────────────┤
 │ Text9          │ Toiminimi (business name)          │ property.name                                     │
 ├────────────────┼────────────────────────────────────┼───────────────────────────────────────────────────┤
 │ Text10         │ Y-tunnus (business ID)             │ property.businessId (blank if absent)             │
 ├────────────────┼────────────────────────────────────┼───────────────────────────────────────────────────┤
 │ Text11         │ Käyntiosoite (visiting address)    │ property.address                                  │
 └────────────────┴────────────────────────────────────┴───────────────────────────────────────────────────┘

 - Accompanying grid holds exactly 5 people (spouse + up to 4 minor children). If a
 primary card ends up with >5 attached people, render a continuation copy of the
 template page for the overflow (attached-only). Schema also enforces a sane cap.
 - Signature has no AcroForm field → overlay the decrypted signature PNG with
 page.drawImage(...) in the signature gap (~PDF x≈75, y≈150–210; final coordinate tuned
 by rendering a sample during implementation).
 - Checkbox on-state name must be read at runtime with checkBox.check() (pdf-lib resolves
 the export value), not hard-coded.

 ---
 1. Shared constants & helpers — packages/shared

 - packages/shared/src/constants.ts: extend PURPOSES_OF_STAY to
 ["Leisure","Business","Meeting","Other"]; add GUEST_TYPES
 (primary|spouse|child|additional_adult) and PASSENGER_CARD_PERSON_ROLES
 (CARD_HOLDER|SPOUSE|MINOR_CHILD).
 - New packages/shared/src/phone.ts using libphonenumber-js (new dep):
 normalizePhoneToE164(input, defaultCountry="FI") and isValidPhone(...). Must accept
 040 123 4567, 0401234567, +358 40 123 4567, 00358 40 123 4567 → +358401234567;
 reject 123.
 - New packages/shared/src/age.ts: ageOn(dateOfBirth, referenceDate) — age computed
 as of arrivalDate, not submission date.
 - Barrel packages/shared/src/index.ts: export the new modules.
 - packages/shared/package.json: add libphonenumber-js.

 2. Shared registration schema — packages/shared/src/schemas/registration.ts

 Replace the flat guestSchema/guestSubmissionRequestSchema with a discriminated
 personSchema on guestType, plus a request schema. Rename arrivalCountry-style field
 to countryOfEntryToFinland; keep citizenship and countryOfEntryToFinland as
 separate fields.

 Per-person requirements:
 - all: firstName, lastName, dateOfBirth.
 - primary / additional_adult: also citizenship, countryOfEntryToFinland, address,
 documentType, documentNumber, email, phone, signature; must be ≥18 as of arrivalDate.
 - spouse: name + DOB only, no signature.
 - child: name + DOB only, <18 as of arrivalDate, no signature.

 Request-level refinements: exactly one primary; any number of additional_adult;
 departureDate >= arrivalDate (same-day allowed); future arrival allowed; Meeting
 accepted; phones normalized to E.164 before persistence; signature must start with
 data:image/png;base64, and stay under a schema size cap (deeper PNG validation server-side).

 Keep the legacy schema exports temporarily for legacy tests/routes; new route uses the new schema.

 3. DB model refactor — packages/db/prisma/schema.prisma

 Add models RegistrationBatch, PassengerCard, PassengerCardPerson,
 PassengerCardSignature, and enums RegistrationBatchStatus
 (RECEIVED|PDF_GENERATING|PDF_READY|FAILED), PassengerCardStatus
 (PENDING_PDF|PDF_READY|FAILED) — per the field lists in the task brief. Add a new
 EncryptedPdfRecord bound to passengerCardId @unique + batchId (leave legacy
 EncryptedPdf in place). Add AuditAction enum values
 REGISTRATION_BATCH_SUBMITTED, PASSENGER_CARD_CREATED, GUEST_SIGNATURE_SUBMITTED.
 Mark GuestSubmission/Guest/EncryptedPdf with /// @deprecated doc comments — keep,
 do not extend.

 Migration:
 pnpm --filter @gr/db prisma migrate dev -n registration_batch_passenger_cards
 Also update apps/api/tests/helpers.ts truncateAll() to TRUNCATE the new tables.

 4. Domain transformation — apps/api/src/domain/buildPassengerCards.ts (new)

 Pure function: one validated form payload → PassengerCardDraft[].
 - primary → creates PRIMARY_WITH_ALLOWED_FAMILY card (holder = primary).
 - spouse (role SPOUSE) + child (role MINOR_CHILD) → attachedPeople on the primary card.
 - each additional_adult → its own ADDITIONAL_ADULT_INDIVIDUAL card (no attached people).
 Backend is the source of truth; not shared with the frontend.

 5. Public registration route — apps/api/src/routes/publicRegistration.ts

 Keep the public URL/contract; replace internals. On submit:
 1. Validate with the new schema; normalize phones to E.164.
 2. assertValidSignaturePng(dataUrl) (new helper): prefix check, base64 decode, PNG magic
 89504e470d0a1a0a, size 300B–300KB; reject non-PNG.
 3. In a Prisma transaction: create one RegistrationBatch; per draft create a
 PassengerCard + its PassengerCardPerson rows; encrypt document numbers via existing
 encryptString (packages/crypto/src/field.ts) using context keyed on the card
 holder's person/card id; for signing card holders store a PassengerCardSignature
 (encrypted PNG via encryptString, signatureSha256, signedAt, signedIpHash,
 signedUserAgent from auditMetaFromRequest).
 4. Enqueue one PDF job per PassengerCard.
 5. Audit REGISTRATION_BATCH_SUBMITTED, PASSENGER_CARD_CREATED,
 GUEST_SIGNATURE_SUBMITTED via writeAudit — metadata carries ids only, no PII, no
 signature bytes, no document number.
 6. Respond 201 { batchId, status:"RECEIVED", passengerCards:[{id,cardHolderName,status}] }.

 No writes to GuestSubmission/Guest.

 6. Queue message + worker

 - packages/queue/src/messages.ts: add passengerCardJobMessageSchema
 { tenantId, propertyId, batchId, passengerCardId } (all uuid) + producer method
 enqueuePassengerCardPdfJob. Keep the legacy pdfJobMessageSchema path for rollback.
 - New apps/worker/src/generatePdfForPassengerCard.ts:
 load card (scoped by id+tenant+property) incl. batch, persons, signature, property;
 decrypt document numbers/signature only when present; build the PDF input; fill template;
 encryptPdf with AAD context { tenantId, propertyId, batchId, passengerCardId, requirementVersion, schemaVersion:"encrypted-passenger-card-pdf-v1" } (extend
 EncryptionContext in packages/crypto/src/envelope.ts to carry batchId/passengerCardId
 instead of submissionId); store blob at new
 passengerCardBlobPath({tenantId,propertyId,batchId,passengerCardId}) (add to
 packages/storage/src/local.ts); create the new EncryptedPdfRecord; set card
 PDF_READY; when all cards in the batch are ready set batch PDF_READY; audit
 PDF_GENERATED. On error → card FAILED, audit PDF_GENERATION_FAILED, rethrow.
 - Wire apps/api/src/server.ts in-process handler and apps/worker/src/main.ts consumer
 to dispatch the new job type. Keep generatePdfForSubmission for legacy rows.

 7. PDF generator — packages/pdf/src/registrationPassengerCard.ts (new)

 Reuse the existing @gr/pdf package (pdf-lib already a dep). Bundle the template as a repo
 asset: copy Matkustajailmoitusmalli.pdf → packages/pdf/templates/passenger-card.pdf
 (load via fs relative to module; ensure it ships in the build).

 generatePassengerCardPdf(input: RegistrationPdfPassengerCard): Promise<Uint8Array>:
 PDFDocument.load(templateBytes), getForm(), set text fields + accompanying grid + tick
 the matching purpose checkbox per the field map above, overlay signature PNG via
 page.drawImage, form.flatten() (make non-editable), doc.save(). >5 attached people →
 append a continuation copy of the template page. Add @pdf-lib/fontkit only if a field
 value needs glyphs outside WinAnsi; otherwise reuse the existing sanitize() approach.
 Keep the old registrationPdf.ts for legacy.

 8. Owner routes — apps/api/src/routes/ownerSubmissions.ts (+ new file)

 Add batch/card read model (keep legacy /submissions/* routes for old data):
 - GET /v1/owner/properties/:propertyId/registration-batches — batches with nested card
 summaries (passengerCardId, cardHolderName, cardType, status, attachedPeopleCount).
 - GET /v1/owner/registration-batches/:batchId.
 - GET /v1/owner/passenger-cards/:passengerCardId/pdf — requireOwnerAuth +
 requireRole(...PDF_DOWNLOAD_ROLES), tenant/property scoped findFirst, load new
 EncryptedPdfRecord, verify sha256Hex(ciphertext), decryptPdf with the card's
 expected context, audit OWNER_DOWNLOADED_PDF, stream application/pdf no-store.
 Never expose signatures/document numbers in JSON — signatures are PDF-only.

 9. Tests (Vitest, tests/ dirs, real Postgres test DB on :5433)

 - shared: phone normalization matrix; schema rules (same-day ok, future arrival ok,
 Meeting accepted, exactly-one-primary, 18-on-arrival boundaries for primary/adult/child,
 spouse/child name+DOB only, countryOfEntry required + separate from citizenship).
 - domain: transformation cases (primary-only→1 card; +spouse/+child→1 card w/ attached;
 +additional_adult→2 cards; primary+spouse+child+2 adults→3 cards).
 - api (apps/api/tests/): submit primary-only / primary+spouse+child /
 primary+additional_adult → correct batch/card/person counts; document numbers &
 signatures encrypted at rest; invalid signature PNG rejected; audit events written; one
 PDF job per card. Update helpers.ts validSubmissionBody to the new people[] shape
 and truncateAll().
 - pdf/worker: one card → one encrypted PDF; additional adult → separate PDF; record
 linked to passengerCardId; batch PDF_READY only when all cards ready; filled PDF
 contains card-holder fields + attached reduced fields; AAD carries
 tenantId/propertyId/batchId/passengerCardId. Verify template fill by re-loading output
 with pdf-lib and reading field values before flatten in a unit-level test.

 ---
 Verification

 1. pnpm --filter @gr/db prisma migrate dev -n registration_batch_passenger_cards then
 pnpm --filter @gr/db prisma generate.
 2. pnpm -r run test — all packages green (shared, crypto, pdf, storage, queue, api, worker).
 3. Manual E2E (in-process queue): POST /v1/guest/register (primary + spouse + 1 child + 1
 additional adult) → expect 1 batch, 2 cards, batch→PDF_READY. GET /v1/owner/registration-batches/:id shows 2 cards; download each
 /passenger-cards/:id/pdf → open PDFs, confirm the official template is filled (holder
 fields, accompanying grid for spouse+child on card 1, purpose checkbox, embedded
 signature) and the additional adult's PDF has an empty grid.
 4. Confirm no new rows in GuestSubmission/Guest; audit log has
 REGISTRATION_BATCH_SUBMITTED / PASSENGER_CARD_CREATED / GUEST_SIGNATURE_SUBMITTED
 with no PII.

 New dependencies

 - libphonenumber-js → @gr/shared
 - @pdf-lib/fontkit → @gr/pdf (only if unicode glyphs needed)

 Open items to finalize during implementation

 - Exact signature overlay coordinates (tune by rendering a sample).
 - Check Box5 semantics (consent vs. voluntary) — confirm before ticking.
 - Property.businessId field for Text10 (Y-tunnus) — add to schema if not present, else leave blank.
 