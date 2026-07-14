import { z } from "zod";

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

export const guestSchema = z.object({
  firstName: z.string().trim().min(1).max(MAX_SHORT),
  lastName: z.string().trim().min(1).max(MAX_SHORT),
  dateOfBirth: isoDateSchema,
  nationality: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "Nationality must be an ISO 3166-1 alpha-2 code")
    .transform((value) => value.toUpperCase()),
  address: z.string().trim().min(1).max(MAX_MEDIUM),
  documentNumber: z.string().trim().min(1).max(MAX_SHORT),
  isPrimaryGuest: z.boolean(),
});

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
  /** Stay dates are fixed when the owner creates the registration link. */
  arrivalDate: isoDateSchema,
  departureDate: isoDateSchema,
});

export type RegistrationLinkInfo = z.infer<typeof registrationLinkInfoSchema>;

/** Allowed link lifetimes (hours). No non-expiring links, no arbitrary values. */
export const LINK_TTL_HOURS = [24, 48, 72, 168] as const;
export type LinkTtlHours = (typeof LINK_TTL_HOURS)[number];

/**
 * Owner request to create/replace a property's single active registration link.
 * Departure may equal arrival (same-day). `expiresAt` is derived server-side
 * from `linkTtlHours`; the client never supplies a raw expiry.
 */
export const activeRegistrationLinkRequestSchema = z
  .object({
    arrivalDate: isoDateSchema,
    departureDate: isoDateSchema,
    maxPassengerCards: z.number().int().min(1).max(20).default(20),
    linkTtlHours: z
      .union([z.literal(24), z.literal(48), z.literal(72), z.literal(168)])
      .default(48),
  })
  .strict()
  .refine((data) => data.departureDate >= data.arrivalDate, {
    message: "Departure date must be on or after arrival date",
    path: ["departureDate"],
  });

export type ActiveRegistrationLinkRequest = z.infer<typeof activeRegistrationLinkRequestSchema>;
