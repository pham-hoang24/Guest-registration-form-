import type { RegistrationCardPdfInput, RegistrationPdfPerson } from "./registrationPdf.js";

/**
 * Draft TEM passenger-card field mapping.
 *
 * This is the single projection from our internal card model onto the fields of
 * the (draft, not-yet-legally-approved) Finnish accommodation passenger card. It
 * is a pure function so the mapping rules — which datum fills which numbered
 * field, when a field must be blank, and how codes become human-readable — are
 * unit-testable independently of pdf-lib layout.
 *
 * Data-minimization (CLAUDE.md invariant, Tier 3A): email, phone,
 * countryOfResidence and documentType are never collected and never appear here.
 * They are absent from `RegistrationCardPdfInput` by construction, so this
 * projection cannot leak them onto the card.
 *
 * Blank rules that MUST hold (asserted by tests):
 * - Field 6 (passport / ID no.) is blank when the holder has no document number
 *   (Nordic citizen, resident in Finland, or identified by Finnish PIC).
 * - Field 12 (country of entry) is blank when the holder is resident in Finland.
 */

export type TemField = {
  /** Field number on the draft TEM card layout. */
  no: number;
  key: string;
  label: string;
  /** Rendered value; the empty string means the field is intentionally blank. */
  value: string;
};

export type TemFamilyRider = {
  no: number;
  surname: string;
  givenNames: string;
  /** PIC-or-DOB only; spouse/minors carry no further detail. */
  identity: string;
};

export type TemCardFields = {
  /** Holder fields 1–6. */
  holder: TemField[];
  /** Spouse + minor children riding on the holder's card, fields 7–11. */
  family: TemFamilyRider[];
  /** Country of entry, field 12 (blank when resident in Finland). */
  countryOfEntry: TemField;
  /** Stay fields 13–15. */
  stay: TemField[];
  /** Accommodation provider fields 17–19. */
  provider: TemField[];
};

let regionNames: Intl.DisplayNames | undefined;

/**
 * ISO 3166-1 alpha-2 code → English country name (TEM wants the full name, not
 * the code). Falls back to the raw code for anything Intl can't resolve.
 */
export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return code;
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(upper) ?? upper;
  } catch {
    return upper;
  }
}

/** Identity string for a person: DOB when present, else Finnish PIC, else blank. */
function identityOf(person: RegistrationPdfPerson): string {
  if (person.dateOfBirth) return person.dateOfBirth;
  if (person.finnishPersonalIdentityCode) return person.finnishPersonalIdentityCode;
  return "";
}

export function mapCardToTemFields(input: RegistrationCardPdfInput): TemCardFields {
  const h = input.cardHolder;

  const holder: TemField[] = [
    { no: 1, key: "surname", label: "Surname", value: h.lastName },
    { no: 2, key: "givenNames", label: "Given names", value: h.firstName },
    { no: 3, key: "picOrDob", label: "Date of birth / personal identity code", value: identityOf(h) },
    { no: 4, key: "nationality", label: "Nationality", value: countryName(h.citizenship) },
    { no: 5, key: "address", label: "Address", value: h.address ?? "" },
    // Field 6 is blank when the holder has no document number (N/A cases).
    { no: 6, key: "documentNumber", label: "Passport / ID no.", value: h.documentNumber ?? "" },
  ];

  const family: TemFamilyRider[] = input.accompanying.map((person, index) => ({
    no: 7 + index,
    surname: person.lastName,
    givenNames: person.firstName,
    identity: identityOf(person),
  }));

  // Country of entry is required only when NOT resident in Finland; a resident's
  // field is blank (the not-applicable reason is internal and never rendered).
  const entryBlank =
    h.isResidentInFinland === true ||
    input.countryOfEntryNotApplicableReason === "RESIDENT_IN_FINLAND";
  const countryOfEntry: TemField = {
    no: 12,
    key: "countryOfEntry",
    label: "Country of entry to Finland",
    value: entryBlank ? "" : countryName(input.countryOfEntryToFinland),
  };

  const stay: TemField[] = [
    { no: 13, key: "arrivalDate", label: "Date of arrival", value: input.arrivalDate },
    {
      no: 14,
      key: "departureDate",
      label: "Date of departure",
      value: input.departureDateKnown && input.departureDate ? input.departureDate : "",
    },
    { no: 15, key: "purposeOfStay", label: "Purpose of stay", value: input.purposeOfStay || "" },
  ];

  const providerAddress = [
    input.property.addressLine1,
    input.property.addressLine2 ?? "",
    `${input.property.postalCode} ${input.property.city}`,
    countryName(input.property.countryCode),
  ]
    .filter((part) => part.trim().length > 0)
    .join(", ");

  const provider: TemField[] = [
    { no: 17, key: "providerName", label: "Accommodation provider", value: input.property.name },
    { no: 18, key: "providerBusinessId", label: "Business ID", value: input.property.businessId ?? "" },
    { no: 19, key: "providerAddress", label: "Provider address", value: providerAddress },
  ];

  return { holder, family, countryOfEntry, stay, provider };
}
