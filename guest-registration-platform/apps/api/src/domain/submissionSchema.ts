import { z } from "zod";
import { isoDateSchema, DOCUMENT_TYPES, PURPOSES_OF_STAY, NORDIC_CITIZENSHIPS, ageOn } from "@gr/shared";

const MAX_SHORT = 100;
const MAX_MEDIUM = 200;

const NORDIC_COUNTRIES = new Set<string>(NORDIC_CITIZENSHIPS);

const nameFields = {
  firstName: z.string().trim().min(1).max(MAX_SHORT),
  lastName: z.string().trim().min(1).max(MAX_SHORT),
  dateOfBirth: isoDateSchema,
};

const citizenshipField = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, "Must be ISO 3166-1 alpha-2")
  .transform((v) => v.toUpperCase());

const adultBaseObject = z.object({
  ...nameFields,
  isResidentInFinland: z.boolean(),
  address: z.string().trim().min(1).max(MAX_MEDIUM),
  documentType: z.enum(DOCUMENT_TYPES).optional(),
  documentNumber: z.string().trim().min(1).max(MAX_SHORT).optional(),
  countryOfEntryToFinland: citizenshipField.optional(),
  citizenship: citizenshipField.optional(),
  finnishPersonalIdentityCode: z.string().trim().min(1).max(MAX_SHORT).optional(),
  email: z.string().trim().email().max(MAX_MEDIUM).optional(),
  phone: z.string().trim().min(5).max(25).optional(),
});

// Plain ZodObjects (no superRefine) so .extend() works and discriminatedUnion accepts them.
// Adult field validation (email/phone, citizenship, residency) is done in payloadSchema.superRefine.
const primarySchema = adultBaseObject.extend({ guestType: z.literal("primary") });
const additionalAdultSchema = adultBaseObject.extend({ guestType: z.literal("additional_adult") });

const spouseSchema = z.object({
  guestType: z.literal("spouse"),
  ...nameFields,
});

const childSchema = z.object({
  guestType: z.literal("child"),
  ...nameFields,
});

export const personSchema = z.discriminatedUnion("guestType", [
  primarySchema,
  additionalAdultSchema,
  spouseSchema,
  childSchema,
]);

export type PayloadPerson = z.infer<typeof personSchema>;
type AdultPerson = z.infer<typeof primarySchema> | z.infer<typeof additionalAdultSchema>;

function validateAdultFields(data: AdultPerson, ctx: z.RefinementCtx, path: (string | number)[]) {
  // At least one contact method required.
  if (!data.email && !data.phone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one of email or phone is required",
      path: [...path, "email"],
    });
  }

  const hasPic = Boolean(data.finnishPersonalIdentityCode);

  if (!hasPic) {
    if (!data.citizenship) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "citizenship is required when finnishPersonalIdentityCode is not provided",
        path: [...path, "citizenship"],
      });
      return;
    }

    const isNordic = NORDIC_COUNTRIES.has(data.citizenship);

    if (!data.isResidentInFinland && !isNordic) {
      if (!data.countryOfEntryToFinland) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "countryOfEntryToFinland is required for non-resident, non-Nordic travelers",
          path: [...path, "countryOfEntryToFinland"],
        });
      }
      if (!data.documentNumber) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "documentNumber is required for non-resident, non-Nordic travelers",
          path: [...path, "documentNumber"],
        });
      }
    }
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
    departureDate: isoDateSchema.optional(),
    departureDateKnown: z.boolean(),
    purposeOfStay: z.enum(PURPOSES_OF_STAY),
    privacyAccepted: z.literal(true, {
      errorMap: () => ({ message: "Privacy notice must be accepted" }),
    }),
    accuracyConfirmed: z.literal(true, {
      errorMap: () => ({ message: "Accuracy of information must be confirmed" }),
    }),
    people: z.array(personSchema).min(1).max(21),
  })
  .superRefine((data, ctx) => {
    // Departure is optional only when explicitly marked unknown. Same-day stays
    // are allowed (departure == arrival); only an earlier departure is rejected.
    if (data.departureDateKnown && !data.departureDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Departure date is required when known",
        path: ["departureDate"],
      });
    }
    if (data.departureDate && data.departureDate < data.arrivalDate) {
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
      const ageAtArrival = ageOn(p.dateOfBirth, data.arrivalDate);

      if (p.guestType === "primary" || p.guestType === "additional_adult") {
        if (ageAtArrival < 18) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Must be at least 18 years old on the arrival date",
            path: ["people", i, "dateOfBirth"],
          });
        }
        // Adult-specific field validation (email/phone, citizenship, residency).
        validateAdultFields(p, ctx, ["people", i]);
      } else if (p.guestType === "child") {
        if (ageAtArrival >= 18) {
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
