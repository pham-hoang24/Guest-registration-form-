# Privacy Notice

Canonical text behind the guest-form privacy checkbox (`confirmation.privacy` in
`apps/web/src/i18n/locales/*.json`). This is a **draft** notice; legal wording is pending human
review (CLAUDE.md invariant 10) and must be verified before production.

## Who processes your data

The accommodation provider (the property owner) is the controller. The platform processes guest
registration data on their behalf.

## Why we collect it

Your details are collected **solely to meet the statutory accommodation registration
obligation** in Finland. The legal basis recorded for each stay is a legal obligation
(`legalBasis = LEGAL_OBLIGATION`).

- Passenger-card data is **not** used for customer service.
- Passenger-card data is **not** used for direct marketing.

## What we collect

Only what the passenger card needs: name, date of birth (or Finnish Personal Identity Code),
nationality, address, travel-document number (when required), country of entry (when required),
arrival/departure dates, purpose of stay, and your signature. Spouses and minor children are
recorded on the primary guest's card with name and date-of-birth (or PIC) only.

**We do not collect** an email address, phone number, country of residence, or travel-document
*type* on the passenger card. These fields are excluded by design.

Providing the **purpose of stay is required** to submit — this is a product rule of this form,
not a statement about what any specific law requires.

## How it is protected

- The generated passenger-card PDF is encrypted (AES-256-GCM, a fresh key per document) and only
  the ciphertext is stored. Plaintext never touches disk or logs.
- Travel-document numbers, Finnish Personal Identity Codes, and signatures are encrypted at rest.
- Access by the property's staff is role-gated and audited. Audit records store only hashed
  network identifiers, never raw IP addresses.

## How long we keep it

Records are retained only as long as needed to meet the registration obligation and then deleted
automatically. See `docs/retention-policy.md`.

## Your rights

Contact the accommodation provider (the controller) to exercise your data-protection rights.
