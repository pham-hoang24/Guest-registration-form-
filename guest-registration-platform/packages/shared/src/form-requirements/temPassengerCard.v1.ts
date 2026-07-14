import { NORDIC_CITIZENSHIPS, PURPOSES_OF_STAY } from "../constants.js";

/**
 * Central form-requirement configuration for the Finnish accommodation
 * passenger card.
 *
 * This is the single source of truth for which fields are collected, why, and
 * under which conditions. Backend validation, the web form, the PDF field
 * mapping, and the tests all consume this — TEM assumptions must never be
 * scattered across Zod / React / PDF / worker code.
 *
 * CLAUDE.md invariant 10: legal correctness is a HUMAN sign-off task, not a code
 * assertion. This version ships `LEGAL_REVIEW_PENDING` and records that it is an
 * engineering interpretation only. Legal sign-off (Tier 4) mints a NEW
 * `TEM_2026_APPROVED_V1`; this draft is never re-labelled.
 */

export type RequirementReviewStatus =
  | "DRAFT"
  | "LEGAL_REVIEW_PENDING"
  | "LEGAL_APPROVED"
  | "DEPRECATED";

/**
 * Why a field exists:
 * - PRODUCT_RULE — we require it as a product decision, not a legal claim.
 * - LEGAL_INTERPRETATION_PENDING — our reading of the TEM model, not yet verified.
 * - DATA_MINIMIZATION — deliberately NOT collected.
 */
export type FieldRequirementType =
  | "PRODUCT_RULE"
  | "LEGAL_INTERPRETATION_PENDING"
  | "DATA_MINIMIZATION";

export type FieldRequirement = {
  requirementType: FieldRequirementType;
  /** Human-readable note on the interpretation / decision behind this field. */
  notes?: string;
  /** When the field is conditionally required, a short descriptor of the rule. */
  requiredWhen?: string;
  /** Reasons a conditionally-required field may be blank (persisted internally). */
  notApplicableReasons?: readonly string[];
};

export type FormRequirementVersion = {
  /** Stable per-version id. Stamped on every submission and bound into the PDF AAD. */
  id: string;
  reviewStatus: RequirementReviewStatus;
  sourceName: string;
  sourceUrl: string | null;
  notes: string;
  /** Max spouse + minor children riding on the primary card. */
  maxFamilyRiders: number;
  fields: Record<string, FieldRequirement>;
};

export const TEM_2026_DRAFT_V1: FormRequirementVersion = {
  id: "FI-TEM-PASSENGER-CARD-2026-DRAFT-V1",
  reviewStatus: "LEGAL_REVIEW_PENDING",
  sourceName:
    "Finnish Act on Accommodation and Catering Operations (308/2006); TEM passenger card model",
  sourceUrl: null,
  notes:
    "Engineering interpretation only. The exact field set, conditional rules, and " +
    "retention periods are NOT legally verified. Owner/guest copy must say the passenger " +
    "card draft is generated from a configured template and that legal / compliance " +
    "verification is pending — never 'official', 'authority-ready', or 'legally compliant'.",
  maxFamilyRiders: 5,
  fields: {
    firstName: { requirementType: "LEGAL_INTERPRETATION_PENDING" },
    lastName: { requirementType: "LEGAL_INTERPRETATION_PENDING" },
    // Exactly one of PIC or dateOfBirth per person (enforced in Tier 3B).
    dateOfBirth: {
      requirementType: "LEGAL_INTERPRETATION_PENDING",
      requiredWhen: "no Finnish personal identity code provided",
    },
    finnishPersonalIdentityCode: {
      requirementType: "LEGAL_INTERPRETATION_PENDING",
      requiredWhen: "no date of birth provided",
    },
    citizenship: {
      requirementType: "LEGAL_INTERPRETATION_PENDING",
      notes: "Always required (field 4); a Finnish personal identity code does not encode nationality.",
    },
    address: { requirementType: "LEGAL_INTERPRETATION_PENDING" },
    isResidentInFinland: {
      requirementType: "PRODUCT_RULE",
      notes: "Explicit required binary choice for every adult; drives fields 6 and 12.",
    },
    documentNumber: {
      requirementType: "LEGAL_INTERPRETATION_PENDING",
      requiredWhen: "not resident in Finland and not a Nordic citizen",
      notApplicableReasons: ["NORDIC_CITIZEN", "RESIDENT_IN_FINLAND"],
      notes: "Holding a Finnish personal identity code does NOT exempt field 6 (TEM footnote 1).",
    },
    countryOfEntryToFinland: {
      requirementType: "LEGAL_INTERPRETATION_PENDING",
      // No Nordic exemption for country-of-entry: anyone not resident in Finland
      // physically entered from somewhere and must state it.
      requiredWhen: "not resident in Finland",
      notApplicableReasons: ["RESIDENT_IN_FINLAND"],
    },
    purposeOfStay: {
      requirementType: "PRODUCT_RULE",
      notes: "Mandatory as a product rule; the TEM model marks purpose non-compulsory.",
    },
    signature: { requirementType: "PRODUCT_RULE" },
    // Deliberately NOT collected (data minimization).
    email: { requirementType: "DATA_MINIMIZATION", notes: "Not collected." },
    phone: { requirementType: "DATA_MINIMIZATION", notes: "Not collected." },
    documentType: { requirementType: "DATA_MINIMIZATION", notes: "Not collected." },
    countryOfResidence: { requirementType: "DATA_MINIMIZATION", notes: "Not collected." },
  },
};

/** The requirement version the running system is configured against. */
export const ACTIVE_FORM_REQUIREMENT_VERSION: FormRequirementVersion = TEM_2026_DRAFT_V1;

/**
 * Requirement version string stamped on every submission and bound into the PDF
 * encryption AAD (CLAUDE.md invariant 3 & 10). It IS the active version's id — a
 * requirement change mints a new id, never a mutated one.
 */
export const REQUIREMENT_VERSION = ACTIVE_FORM_REQUIREMENT_VERSION.id;

/** Nordic citizenships exempt the card holder from the country-of-entry requirement. */
export const NORDIC_CITIZENSHIP_SET: ReadonlySet<string> = new Set<string>(NORDIC_CITIZENSHIPS);

export const PURPOSE_OF_STAY_SET: ReadonlySet<string> = new Set<string>(PURPOSES_OF_STAY);
