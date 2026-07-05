import { describe, expect, it } from "vitest";
import {
  registrationFormSchema,
  groupIntoCards,
  toPayloadPeople,
  type PersonForm,
} from "./formSchema.js";

const adult = (over: Partial<PersonForm> = {}): PersonForm => ({
  guestType: "primary",
  firstName: "Anna",
  lastName: "Example",
  dateOfBirth: "1990-04-12",
  isResidentInFinland: false,
  address: "Street 1",
  documentType: "passport",
  documentNumber: "X1234567",
  citizenship: "DE",
  countryOfEntryToFinland: "SE",
  finnishPersonalIdentityCode: "",
  email: "a@example.com",
  phone: "",
  ...over,
});

describe("groupIntoCards", () => {
  it("puts primary + spouse + child on one card and each adult on its own", () => {
    const people: PersonForm[] = [
      adult({ guestType: "primary" }),
      { guestType: "spouse", firstName: "Ben", lastName: "Example", dateOfBirth: "1991-02-02" },
      { guestType: "child", firstName: "Cara", lastName: "Example", dateOfBirth: "2018-05-05" },
      adult({ guestType: "additional_adult", firstName: "Dora", citizenship: "SE", countryOfEntryToFinland: "" }),
      adult({ guestType: "additional_adult", firstName: "Erik", citizenship: "SE", countryOfEntryToFinland: "" }),
    ];
    const cards = groupIntoCards(people);
    expect(cards).toHaveLength(3);
    expect(cards[0]!.signatureField).toBe("signature_primary");
    expect(cards[0]!.riders).toHaveLength(2);
    expect(cards[1]!.signatureField).toBe("signature_additionalAdult_0");
    expect(cards[2]!.signatureField).toBe("signature_additionalAdult_1");
    expect(cards[1]!.riders).toHaveLength(0);
  });
});

describe("toPayloadPeople", () => {
  it("omits adult-only fields for spouse and child rows", () => {
    const out = toPayloadPeople([
      adult({ guestType: "primary" }),
      { guestType: "child", firstName: "Cara", lastName: "Example", dateOfBirth: "2018-05-05" },
    ]);
    expect(out[1]).toEqual({
      guestType: "child",
      firstName: "Cara",
      lastName: "Example",
      dateOfBirth: "2018-05-05",
    });
    // Primary keeps its adult fields and drops empty-string optionals.
    expect(out[0]).toMatchObject({ guestType: "primary", citizenship: "DE", countryOfEntryToFinland: "SE" });
    expect(out[0]).not.toHaveProperty("phone");
    expect(out[0]).not.toHaveProperty("finnishPersonalIdentityCode");
  });
});

describe("registrationFormSchema", () => {
  const base = {
    arrivalDate: "2026-07-20",
    departureDate: "2026-07-23",
    departureDateKnown: true,
    purposeOfStay: "Leisure" as const,
    privacyAccepted: true as const,
    accuracyConfirmed: true as const,
    people: [adult()],
  };

  it("accepts a valid same-day stay", () => {
    expect(registrationFormSchema.safeParse({ ...base, departureDate: "2026-07-20" }).success).toBe(true);
  });

  it("rejects departure before arrival", () => {
    const r = registrationFormSchema.safeParse({ ...base, departureDate: "2026-07-19" });
    expect(r.success).toBe(false);
  });

  it("allows unknown departure with no date", () => {
    const r = registrationFormSchema.safeParse({ ...base, departureDateKnown: false, departureDate: "" });
    expect(r.success).toBe(true);
  });

  it("requires country of entry for a non-resident non-Nordic adult", () => {
    const r = registrationFormSchema.safeParse({
      ...base,
      people: [adult({ citizenship: "DE", countryOfEntryToFinland: "", isResidentInFinland: false })],
    });
    expect(r.success).toBe(false);
  });

  it("waives country of entry for a Nordic citizen", () => {
    const r = registrationFormSchema.safeParse({
      ...base,
      people: [adult({ citizenship: "SE", countryOfEntryToFinland: "" })],
    });
    expect(r.success).toBe(true);
  });
});
