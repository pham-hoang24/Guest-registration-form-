import { z } from "zod";
import { DOCUMENT_TYPES } from "../constants.js";

const MAX_SHORT = 100;
const MAX_MEDIUM = 200;

/** "YYYY-MM-DD" that parses to a real calendar date. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, "Invalid calendar date");

export const guestSchema = z
  .object({
    firstName: z.string().trim().min(1).max(MAX_SHORT),
    lastName: z.string().trim().min(1).max(MAX_SHORT),
    dateOfBirth: isoDateSchema,
    nationality: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/, "Nationality must be an ISO 3166-1 alpha-2 code")
      .transform((value) => value.toUpperCase()),
    address: z.string().trim().min(1).max(MAX_MEDIUM),
    documentType: z.enum(DOCUMENT_TYPES),
    documentNumber: z.string().trim().min(1).max(MAX_SHORT),
    isPrimaryGuest: z.boolean(),
  })
  .strict();

export const guestSubmissionRequestSchema = z
  .object({
    arrivalDate: isoDateSchema,
    departureDate: isoDateSchema,
    purposeOfStay: z.string().trim().min(1).max(MAX_SHORT),
    guestEmail: z.string().trim().email().max(MAX_MEDIUM),
    guestPhone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{5,25}$/, "Invalid phone number"),
    guests: z.array(guestSchema).min(1, "At least one guest is required").max(20),
    privacyAccepted: z.literal(true, {
      errorMap: () => ({ message: "Privacy notice must be accepted" }),
    }),
    accuracyConfirmed: z.literal(true, {
      errorMap: () => ({ message: "Accuracy of information must be confirmed" }),
    }),
  })
  .strict()
  .refine((data) => data.departureDate > data.arrivalDate, {
    message: "Departure date must be after arrival date",
    path: ["departureDate"],
  })
  .refine((data) => data.guests.filter((g) => g.isPrimaryGuest).length === 1, {
    message: "Exactly one primary guest is required",
    path: ["guests"],
  });

export type GuestInput = z.infer<typeof guestSchema>;
export type GuestSubmissionRequest = z.infer<typeof guestSubmissionRequestSchema>;

export const registrationLinkInfoSchema = z.object({
  propertyName: z.string(),
  propertyCity: z.string(),
  requirementVersion: z.string(),
  supportedLanguages: z.array(z.string()),
});

export type RegistrationLinkInfo = z.infer<typeof registrationLinkInfoSchema>;
