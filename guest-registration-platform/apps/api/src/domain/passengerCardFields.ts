import { NORDIC_CITIZENSHIPS, finnishPicBirthDate } from "@gr/shared";

/**
 * Conditional-field derivation for passenger cards — the ONE place the
 * requirement engine's document-number / country-of-entry rules live, consumed
 * by both Zod validation (submissionSchema) and persistence (publicRegistration)
 * so the two can never drift. See temPassengerCard.v1.ts for the rule sources.
 */

const NORDIC = new Set<string>(NORDIC_CITIZENSHIPS);

export function isNordicCitizenship(citizenship: string | null | undefined): boolean {
  return Boolean(citizenship && NORDIC.has(citizenship));
}

/**
 * A person's birth date: the explicit DOB, else derived from a valid Finnish
 * personal identity code, else null (never persisted on the PIC path).
 */
export function personBirthDate(p: {
  dateOfBirth?: string | null;
  finnishPersonalIdentityCode?: string | null;
}): string | null {
  if (p.dateOfBirth) return p.dateOfBirth;
  if (p.finnishPersonalIdentityCode) return finnishPicBirthDate(p.finnishPersonalIdentityCode);
  return null;
}

export type DocumentNumberNotApplicableReason =
  | "RESIDENT_IN_FINLAND"
  | "HAS_FINNISH_PIC"
  | "NORDIC_CITIZEN";

/**
 * Whether an adult must supply a travel document number, and if not, the
 * internal reason recorded instead of a silent null. Precedence: resident →
 * Finnish PIC → Nordic citizen.
 */
export function documentNumberApplicability(a: {
  isResidentInFinland: boolean;
  citizenship?: string | null;
  finnishPersonalIdentityCode?: string | null;
}): { required: boolean; notApplicableReason: DocumentNumberNotApplicableReason | null } {
  if (a.isResidentInFinland) return { required: false, notApplicableReason: "RESIDENT_IN_FINLAND" };
  if (a.finnishPersonalIdentityCode) return { required: false, notApplicableReason: "HAS_FINNISH_PIC" };
  if (isNordicCitizenship(a.citizenship)) return { required: false, notApplicableReason: "NORDIC_CITIZEN" };
  return { required: true, notApplicableReason: null };
}

export type CountryOfEntryNotApplicableReason = "RESIDENT_IN_FINLAND";

/**
 * Country-of-entry is required for anyone not resident in Finland (no Nordic
 * exemption). Residents record RESIDENT_IN_FINLAND instead.
 */
export function countryOfEntryApplicability(a: {
  isResidentInFinland: boolean;
  countryOfEntryToFinland?: string | null;
}): {
  value: string | null;
  required: boolean;
  notApplicableReason: CountryOfEntryNotApplicableReason | null;
} {
  if (a.isResidentInFinland) {
    return { value: null, required: false, notApplicableReason: "RESIDENT_IN_FINLAND" };
  }
  return { value: a.countryOfEntryToFinland ?? null, required: true, notApplicableReason: null };
}
