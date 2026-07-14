import { z } from "zod";
import {
  isoDateSchema,
  normalizedString,
  PURPOSES_OF_STAY,
  ageOn,
  isValidFinnishPic,
  isKnownCountryCode,
} from "@gr/shared";
import {
  personBirthDate,
  documentNumberApplicability,
  countryOfEntryApplicability,
} from "./passengerCardFields.js";

// Per-field length limits (data minimization + defense in depth). Contact fields
// (email / phone) and documentType are NOT collected — see the requirement engine.
const MAX_NAME = 100;
const MAX_ADDRESS = 300;
const MAX_DOCUMENT_NUMBER = 80;
const MAX_PIC = 32;

/** Finnish personal identity code: normalized + format/checksum-validated. */
const finnishPicField = z
  .string()
  .trim()
  .toUpperCase()
  .max(MAX_PIC)
  .refine(isValidFinnishPic, "Invalid Finnish personal identity code");

/** ISO 3166-1 alpha-2 code, normalized and rejected unless assigned. */
const countryCodeField = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isKnownCountryCode, "Must be a known ISO 3166-1 alpha-2 country code");

// Identity is PIC-or-DOB for EVERY person: both optional at the field level,
// with exactly-one enforced (and age derived) in payloadSchema.superRefine.
const identityFields = {
  firstName: normalizedString({ max: MAX_NAME }),
  lastName: normalizedString({ max: MAX_NAME }),
  dateOfBirth: isoDateSchema.optional(),
  finnishPersonalIdentityCode: finnishPicField.optional(),
};

const adultBaseObject = z.object({
  ...identityFields,
  isResidentInFinland: z.boolean(),
  address: normalizedString({ max: MAX_ADDRESS }),
  documentNumber: normalizedString({ max: MAX_DOCUMENT_NUMBER }).optional(),
  countryOfEntryToFinland: countryCodeField.optional(),
  citizenship: countryCodeField.optional(),
});

// Plain ZodObjects (no superRefine) so .extend() works and discriminatedUnion accepts them.
// Cross-field validation (PIC-vs-DOB, citizenship, residency) is done in payloadSchema.superRefine.
// .strict() rejects unknown fields at this trust boundary (CLAUDE.md: Zod at every trust boundary).
const primarySchema = adultBaseObject.extend({ guestType: z.literal("primary") }).strict();
const additionalAdultSchema = adultBaseObject
  .extend({ guestType: z.literal("additional_adult") })
  .strict();

const spouseSchema = z
  .object({
    guestType: z.literal("spouse"),
    ...identityFields,
  })
  .strict();

const childSchema = z
  .object({
    guestType: z.literal("child"),
    ...identityFields,
  })
  .strict();

export const personSchema = z.discriminatedUnion("guestType", [
  primarySchema,
  additionalAdultSchema,
  spouseSchema,
  childSchema,
]);

export type PayloadPerson = z.infer<typeof personSchema>;
type AdultPerson = z.infer<typeof primarySchema> | z.infer<typeof additionalAdultSchema>;

/**
 * Exactly one of Finnish personal identity code or date of birth per person.
 * Returns the derived birth date (`YYYY-MM-DD`) when resolvable, else null.
 */
function validateIdentity(
  p: { dateOfBirth?: string; finnishPersonalIdentityCode?: string },
  ctx: z.RefinementCtx,
  path: (string | number)[],
): string | null {
  const hasDob = Boolean(p.dateOfBirth);
  const hasPic = Boolean(p.finnishPersonalIdentityCode);

  if (hasDob && hasPic) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide either a date of birth or a Finnish personal identity code, not both",
      path: [...path, "dateOfBirth"],
    });
    return null;
  }
  if (!hasDob && !hasPic) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A date of birth or a Finnish personal identity code is required",
      path: [...path, "dateOfBirth"],
    });
    return null;
  }
  // PIC format/checksum already validated at the field level, so a birthdate is derivable.
  return personBirthDate(p);
}

function validateAdultFields(data: AdultPerson, ctx: z.RefinementCtx, path: (string | number)[]) {
  // Nationality (field 4) is always required — a Finnish PIC does not encode it.
  if (!data.citizenship) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "citizenship is required",
      path: [...path, "citizenship"],
    });
  }

  // Country of entry: required for anyone not resident in Finland (no Nordic exemption).
  const coe = countryOfEntryApplicability(data);
  if (coe.required && !data.countryOfEntryToFinland) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "countryOfEntryToFinland is required for travelers not resident in Finland",
      path: [...path, "countryOfEntryToFinland"],
    });
  }

  // Passport / ID number (field 6): required for non-resident, non-Nordic travelers.
  // Holding a Finnish PIC does NOT exempt field 6.
  const doc = documentNumberApplicability(data);
  if (doc.required && !data.documentNumber) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "documentNumber is required for non-resident, non-Nordic travelers",
      path: [...path, "documentNumber"],
    });
  }
}

/**
 * Full multipart payload schema (parsed from the `payload` JSON field).
 * Stay fields (arrivalDate, departureDate, purposeOfStay) are for confirmation
 * only — the backend compares them against the existing GuestSubmission and
 * returns 400 on mismatch.
 */
export const payloadSchema = z
  .object({
    arrivalDate: isoDateSchema,
    departureDate: isoDateSchema,
    purposeOfStay: z.enum(PURPOSES_OF_STAY),
    privacyAccepted: z.literal(true, {
      errorMap: () => ({ message: "Privacy notice must be accepted" }),
    }),
    accuracyConfirmed: z.literal(true, {
      errorMap: () => ({ message: "Accuracy of information must be confirmed" }),
    }),
    people: z.array(personSchema).min(1).max(21),
  })
  .strict()
  .superRefine((data, ctx) => {
    // Departure is always required. Same-day stays are allowed
    // (departure == arrival); only an earlier departure is rejected.
    if (data.departureDate < data.arrivalDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Departure date cannot be before arrival date",
        path: ["departureDate"],
      });
    }

    const primaries = data.people.filter((p) => p.guestType === "primary");
    if (primaries.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Exactly one primary guest is required",
        path: ["people"],
      });
    }

    for (let i = 0; i < data.people.length; i++) {
      const p = data.people[i]!;

      // Identity (PIC-or-DOB) → derived birth date used for the age rules.
      const birthDate = validateIdentity(p, ctx, ["people", i]);
      const ageAtArrival = birthDate ? ageOn(birthDate, data.arrivalDate) : null;

      if (p.guestType === "primary" || p.guestType === "additional_adult") {
        if (ageAtArrival !== null && ageAtArrival < 18) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Must be at least 18 years old on the arrival date",
            path: ["people", i, "dateOfBirth"],
          });
        }
        validateAdultFields(p, ctx, ["people", i]);
      } else if (p.guestType === "child") {
        if (ageAtArrival !== null && ageAtArrival >= 18) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Child must be under 18 on the arrival date",
            path: ["people", i, "dateOfBirth"],
          });
        }
      }
    }

    const familyRiders = data.people.filter(
      (p) => p.guestType === "spouse" || p.guestType === "child",
    );
    if (familyRiders.length > 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At most 5 family riders (spouse + children) allowed on the primary card",
        path: ["people"],
      });
    }
  });

export type SubmissionPayload = z.infer<typeof payloadSchema>;
