import { describe, expect, it } from "vitest";
import { generateRegistrationPdf, type RegistrationPdfInput } from "../src/index.js";

const input: RegistrationPdfInput = {
  submissionId: "11111111-1111-1111-1111-111111111111",
  requirementVersion: "FI-ACCOMMODATION-2026-01",
  property: {
    name: "Example Cabin",
    addressLine1: "Example Street 1",
    addressLine2: null,
    postalCode: "33100",
    city: "Tampere",
    countryCode: "FI",
    businessId: "1234567-8",
  },
  arrivalDate: "2026-07-20",
  departureDate: "2026-07-23",
  purposeOfStay: "Leisure",
  guestEmail: "guest@example.com",
  guestPhone: "+358401234567",
  guests: [
    {
      firstName: "Anna",
      lastName: "Example",
      dateOfBirth: "1995-04-12",
      nationality: "FI",
      address: "Example Street 1, Helsinki",
      documentType: "passport",
      documentNumber: "X1234567",
      isPrimaryGuest: true,
    },
  ],
  generatedAt: new Date("2026-07-20T12:00:00Z"),
};

describe("generateRegistrationPdf", () => {
  it("produces a valid PDF document", async () => {
    const bytes = await generateRegistrationPdf(input);
    expect(bytes.length).toBeGreaterThan(500);
    expect(Buffer.from(bytes.subarray(0, 5)).toString("ascii")).toBe("%PDF-");
  });

  it("handles many guests by paginating", async () => {
    const guests = Array.from({ length: 15 }, (_, i) => ({
      ...input.guests[0]!,
      firstName: `Guest${i}`,
      isPrimaryGuest: i === 0,
    }));
    const bytes = await generateRegistrationPdf({ ...input, guests });
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("does not crash on non-WinAnsi characters", async () => {
    const bytes = await generateRegistrationPdf({
      ...input,
      guests: [{ ...input.guests[0]!, firstName: "Анна", address: "Хельсинки 1" }],
    });
    expect(bytes.length).toBeGreaterThan(500);
  });
});
