import { z } from "zod";
import { PURPOSES_OF_STAY, NORDIC_CITIZENSHIPS, ageOn } from "@gr/shared";

// Lightweight mirror of the API payload schema (apps/api/src/domain/submissionSchema.ts).
// The server re-validates authoritatively; this exists to guide the guest.
const NORDIC = new Set<string>(NORDIC_CITIZENSHIPS);

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const cc = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, "Two-letter code")
  .transform((v) => v.toUpperCase());

const name = {
  firstName: z.string().trim().min(1, "Required").max(100),
  lastName: z.string().trim().min(1, "Required").max(100),
  dateOfBirth: iso,
};

// A single "person" row. All adult fields are optional at the field level and
// enforced conditionally in the superRefine below (matching the server).
export const personFormSchema = z.object({
  guestType: z.enum(["primary", "spouse", "child", "additional_adult"]),
  ...name,
  isResidentInFinland: z.boolean().optional(),
  address: z.string().trim().max(300).optional(),
  documentNumber: z.string().trim().max(80).optional(),
  citizenship: z.union([cc, z.literal("")]).optional(),
  countryOfEntryToFinland: z.union([cc, z.literal("")]).optional(),
  finnishPersonalIdentityCode: z.string().trim().max(32).optional(),
});

export type PersonForm = z.infer<typeof personFormSchema>;

export const registrationFormSchema = z
  .object({
    arrivalDate: iso,
    departureDate: z.string().optional(),
    departureDateKnown: z.boolean(),
    purposeOfStay: z.enum(PURPOSES_OF_STAY),
    privacyAccepted: z.literal(true, {
      errorMap: () => ({ message: "Privacy notice must be accepted" }),
    }),
    accuracyConfirmed: z.literal(true, {
      errorMap: () => ({ message: "Please confirm the information is accurate" }),
    }),
    people: z.array(personFormSchema).min(1).max(21),
  })
  .superRefine((data, ctx) => {
    if (data.departureDateKnown && !data.departureDate) {
      ctx.addIssue({ code: "custom", message: "Required when known", path: ["departureDate"] });
    }
    if (data.departureDate && data.departureDate < data.arrivalDate) {
      ctx.addIssue({ code: "custom", message: "Cannot be before arrival", path: ["departureDate"] });
    }

    data.people.forEach((p, i) => {
      const age = ageOn(p.dateOfBirth, data.arrivalDate || p.dateOfBirth);
      const isAdultType = p.guestType === "primary" || p.guestType === "additional_adult";

      if (isAdultType) {
        if (age < 18) {
          ctx.addIssue({ code: "custom", message: "Must be 18+ on arrival", path: ["people", i, "dateOfBirth"] });
        }
        if (!p.address) {
          ctx.addIssue({ code: "custom", message: "Required", path: ["people", i, "address"] });
        }
        const hasPic = Boolean(p.finnishPersonalIdentityCode);
        if (!hasPic) {
          if (!p.citizenship) {
            ctx.addIssue({ code: "custom", message: "Required", path: ["people", i, "citizenship"] });
          } else if (!p.isResidentInFinland && !NORDIC.has(p.citizenship)) {
            if (!p.countryOfEntryToFinland) {
              ctx.addIssue({ code: "custom", message: "Required", path: ["people", i, "countryOfEntryToFinland"] });
            }
            if (!p.documentNumber) {
              ctx.addIssue({ code: "custom", message: "Required", path: ["people", i, "documentNumber"] });
            }
          }
        }
      } else if (p.guestType === "child" && age >= 18) {
        ctx.addIssue({ code: "custom", message: "Child must be under 18", path: ["people", i, "dateOfBirth"] });
      }
    });
  });

export type RegistrationForm = z.infer<typeof registrationFormSchema>;

/** Cards derived for the review step: primary+spouse+children = one card; each adult = its own card. */
export function groupIntoCards(people: PersonForm[]): { holder: PersonForm; riders: PersonForm[]; signatureField: string }[] {
  const cards: { holder: PersonForm; riders: PersonForm[]; signatureField: string }[] = [];
  const primary = people.find((p) => p.guestType === "primary");
  if (primary) {
    const riders = people.filter((p) => p.guestType === "spouse" || p.guestType === "child");
    cards.push({ holder: primary, riders, signatureField: "signature_primary" });
  }
  let adultIndex = 0;
  for (const p of people) {
    if (p.guestType === "additional_adult") {
      cards.push({ holder: p, riders: [], signatureField: `signature_additionalAdult_${adultIndex}` });
      adultIndex++;
    }
  }
  return cards;
}

/** Strips empty-string optionals so the JSON payload matches the API schema. */
export function toPayloadPeople(people: PersonForm[]): Record<string, unknown>[] {
  return people.map((p) => {
    const base: Record<string, unknown> = {
      guestType: p.guestType,
      firstName: p.firstName,
      lastName: p.lastName,
      dateOfBirth: p.dateOfBirth,
    };
    if (p.guestType === "primary" || p.guestType === "additional_adult") {
      base.isResidentInFinland = Boolean(p.isResidentInFinland);
      base.address = p.address;
      if (p.documentNumber) base.documentNumber = p.documentNumber;
      if (p.citizenship) base.citizenship = p.citizenship;
      if (p.countryOfEntryToFinland) base.countryOfEntryToFinland = p.countryOfEntryToFinland;
      if (p.finnishPersonalIdentityCode) base.finnishPersonalIdentityCode = p.finnishPersonalIdentityCode;
    }
    return base;
  });
}
