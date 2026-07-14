import { z } from "zod";
import {
  PURPOSES_OF_STAY,
  NORDIC_CITIZENSHIPS,
  ageOn,
  isValidFinnishPic,
  isKnownCountryCode,
  finnishPicBirthDate,
} from "@gr/shared";

// Lightweight mirror of the API payload schema (apps/api/src/domain/submissionSchema.ts).
// The server re-validates authoritatively; this exists to guide the guest.
const NORDIC = new Set<string>(NORDIC_CITIZENSHIPS);

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

// Identity is PIC-or-DOB for every person; both optional here, exactly-one enforced below.
const name = {
  firstName: z.string().trim().min(1, "Required").max(100),
  lastName: z.string().trim().min(1, "Required").max(100),
  dateOfBirth: z.string().trim().optional(),
  finnishPersonalIdentityCode: z.string().trim().max(32).optional(),
};

// A single "person" row. All conditional fields are optional at the field level
// and enforced in the superRefine below (matching the server).
export const personFormSchema = z.object({
  guestType: z.enum(["primary", "spouse", "child", "additional_adult"]),
  ...name,
  isResidentInFinland: z.boolean().optional(),
  address: z.string().trim().max(300).optional(),
  documentNumber: z.string().trim().max(80).optional(),
  citizenship: z.string().trim().optional(),
  countryOfEntryToFinland: z.string().trim().optional(),
});

export type PersonForm = z.infer<typeof personFormSchema>;

/** Resolves a person's birth date from DOB or a valid PIC, else null. */
function birthDateOf(p: PersonForm): string | null {
  if (p.dateOfBirth) return p.dateOfBirth;
  if (p.finnishPersonalIdentityCode && isValidFinnishPic(p.finnishPersonalIdentityCode)) {
    return finnishPicBirthDate(p.finnishPersonalIdentityCode);
  }
  return null;
}

export const registrationFormSchema = z
  .object({
    arrivalDate: iso,
    departureDate: iso,
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
    if (data.departureDate < data.arrivalDate) {
      ctx.addIssue({ code: "custom", message: "Cannot be before arrival", path: ["departureDate"] });
    }

    data.people.forEach((p, i) => {
      const hasDob = Boolean(p.dateOfBirth);
      const hasPic = Boolean(p.finnishPersonalIdentityCode);

      // Exactly one of DOB or PIC.
      if (hasDob && hasPic) {
        ctx.addIssue({ code: "custom", message: "Provide either a date of birth or a PIC, not both", path: ["people", i, "dateOfBirth"] });
      } else if (!hasDob && !hasPic) {
        ctx.addIssue({ code: "custom", message: "Date of birth or Finnish personal identity code required", path: ["people", i, "dateOfBirth"] });
      }
      if (hasPic && !isValidFinnishPic(p.finnishPersonalIdentityCode!)) {
        ctx.addIssue({ code: "custom", message: "Invalid Finnish personal identity code", path: ["people", i, "finnishPersonalIdentityCode"] });
      }

      const birthDate = birthDateOf(p);
      const age = birthDate ? ageOn(birthDate, data.arrivalDate || birthDate) : null;
      const isAdultType = p.guestType === "primary" || p.guestType === "additional_adult";

      if (isAdultType) {
        if (age !== null && age < 18) {
          ctx.addIssue({ code: "custom", message: "Must be 18+ on arrival", path: ["people", i, "dateOfBirth"] });
        }
        if (!p.address) {
          ctx.addIssue({ code: "custom", message: "Required", path: ["people", i, "address"] });
        }
        if (p.citizenship && !isKnownCountryCode(p.citizenship)) {
          ctx.addIssue({ code: "custom", message: "Unknown country", path: ["people", i, "citizenship"] });
        }
        if (p.countryOfEntryToFinland && !isKnownCountryCode(p.countryOfEntryToFinland)) {
          ctx.addIssue({ code: "custom", message: "Unknown country", path: ["people", i, "countryOfEntryToFinland"] });
        }
        // Residency is an explicit required choice; it drives the rules below.
        if (p.isResidentInFinland === undefined) {
          ctx.addIssue({ code: "custom", message: "Please choose", path: ["people", i, "isResidentInFinland"] });
        }
        // Nationality (field 4) is always required — a Finnish PIC does not encode it.
        if (!p.citizenship) {
          ctx.addIssue({ code: "custom", message: "Required", path: ["people", i, "citizenship"] });
        }
        // Country of entry (field 12) required for non-residents (no Nordic exemption).
        if (p.isResidentInFinland === false && !p.countryOfEntryToFinland) {
          ctx.addIssue({ code: "custom", message: "Required", path: ["people", i, "countryOfEntryToFinland"] });
        }
        // Passport / ID number (field 6) required for a non-resident, non-Nordic traveler.
        // Holding a Finnish PIC does NOT exempt field 6.
        if (
          p.isResidentInFinland === false &&
          p.citizenship &&
          !NORDIC.has(p.citizenship.toUpperCase()) &&
          !p.documentNumber
        ) {
          ctx.addIssue({ code: "custom", message: "Required", path: ["people", i, "documentNumber"] });
        }
      } else if (p.guestType === "child" && age !== null && age >= 18) {
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

/** A short human label for a person's identity basis, used in the review step. */
export function identityLabel(p: PersonForm): string {
  if (p.dateOfBirth) return p.dateOfBirth;
  if (p.finnishPersonalIdentityCode) return p.finnishPersonalIdentityCode;
  return "";
}

/** Strips empty-string optionals so the JSON payload matches the API schema. */
export function toPayloadPeople(people: PersonForm[]): Record<string, unknown>[] {
  return people.map((p) => {
    const base: Record<string, unknown> = {
      guestType: p.guestType,
      firstName: p.firstName,
      lastName: p.lastName,
    };
    // Identity: exactly one of DOB or PIC travels with every person.
    if (p.dateOfBirth) base.dateOfBirth = p.dateOfBirth;
    if (p.finnishPersonalIdentityCode) base.finnishPersonalIdentityCode = p.finnishPersonalIdentityCode;
    if (p.guestType === "primary" || p.guestType === "additional_adult") {
      base.isResidentInFinland = Boolean(p.isResidentInFinland);
      base.address = p.address;
      if (p.documentNumber) base.documentNumber = p.documentNumber;
      if (p.citizenship) base.citizenship = p.citizenship;
      if (p.countryOfEntryToFinland) base.countryOfEntryToFinland = p.countryOfEntryToFinland;
    }
    return base;
  });
}
