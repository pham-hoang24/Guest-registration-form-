import { describe, expect, it } from "vitest";
import { guestSubmissionRequestSchema } from "../src/schemas/registration.js";

const validGuest = {
  firstName: "Anna",
  lastName: "Example",
  dateOfBirth: "1995-04-12",
  nationality: "FI",
  address: "Example Street 1, Helsinki",
  documentType: "passport",
  documentNumber: "X1234567",
  isPrimaryGuest: true,
};

const validSubmission = {
  arrivalDate: "2026-07-20",
  departureDate: "2026-07-23",
  purposeOfStay: "Leisure",
  guestEmail: "guest@example.com",
  guestPhone: "+358401234567",
  guests: [validGuest],
  privacyAccepted: true,
  accuracyConfirmed: true,
};

describe("guestSubmissionRequestSchema", () => {
  it("accepts a valid submission", () => {
    const result = guestSubmissionRequestSchema.safeParse(validSubmission);
    expect(result.success).toBe(true);
  });

  it("rejects departure date not after arrival date", () => {
    for (const departureDate of ["2026-07-20", "2026-07-19"]) {
      const result = guestSubmissionRequestSchema.safeParse({
        ...validSubmission,
        departureDate,
      });
      expect(result.success).toBe(false);
    }
  });

  it("requires privacyAccepted to be true", () => {
    const result = guestSubmissionRequestSchema.safeParse({
      ...validSubmission,
      privacyAccepted: false,
    });
    expect(result.success).toBe(false);
  });

  it("requires accuracyConfirmed to be true", () => {
    const result = guestSubmissionRequestSchema.safeParse({
      ...validSubmission,
      accuracyConfirmed: false,
    });
    expect(result.success).toBe(false);
  });

  it("requires at least one guest", () => {
    const result = guestSubmissionRequestSchema.safeParse({
      ...validSubmission,
      guests: [],
    });
    expect(result.success).toBe(false);
  });

  it("requires exactly one primary guest", () => {
    const noPrimary = guestSubmissionRequestSchema.safeParse({
      ...validSubmission,
      guests: [{ ...validGuest, isPrimaryGuest: false }],
    });
    expect(noPrimary.success).toBe(false);

    const twoPrimary = guestSubmissionRequestSchema.safeParse({
      ...validSubmission,
      guests: [validGuest, { ...validGuest, firstName: "Ben" }],
    });
    expect(twoPrimary.success).toBe(false);
  });

  it("rejects invalid calendar dates", () => {
    const result = guestSubmissionRequestSchema.safeParse({
      ...validSubmission,
      arrivalDate: "2026-02-30",
    });
    expect(result.success).toBe(false);
  });

  it("rejects overlong strings", () => {
    const result = guestSubmissionRequestSchema.safeParse({
      ...validSubmission,
      purposeOfStay: "x".repeat(101),
    });
    expect(result.success).toBe(false);
  });
});
