import { describe, expect, it } from "vitest";
import { countryName, mapCardToTemFields } from "../src/index.js";
import type { RegistrationCardPdfInput } from "../src/index.js";

const base: RegistrationCardPdfInput = {
  guestSubmissionId: "22222222-2222-2222-2222-222222222222",
  passengerCardId: "11111111-1111-1111-1111-111111111111",
  cardNumber: 1,
  cardType: "PRIMARY_WITH_ALLOWED_FAMILY",
  requirementVersion: "FI-TEM-PASSENGER-CARD-2026-DRAFT-V1",
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
  countryOfEntryToFinland: "SE",
  countryOfEntryNotApplicableReason: null,
  cardHolder: {
    roleOnCard: "CARD_HOLDER",
    firstName: "Anna",
    lastName: "Example",
    dateOfBirth: "1995-04-12",
    citizenship: "DE",
    isResidentInFinland: false,
    address: "Example Street 1, Helsinki",
    documentNumber: "X1234567",
  },
  accompanying: [],
  signaturePng: new Uint8Array(),
  signedAt: new Date("2026-07-20T11:59:00Z"),
  generatedAt: new Date("2026-07-20T12:00:00Z"),
};

const fieldValue = (fields: { key: string; value: string }[], key: string) =>
  fields.find((f) => f.key === key)?.value;

describe("countryName", () => {
  it("maps ISO alpha-2 codes to full English names", () => {
    expect(countryName("SE")).toBe("Sweden");
    expect(countryName("DE")).toBe("Germany");
    expect(countryName("fi")).toBe("Finland");
  });

  it("returns empty string for nullish and passes through non-codes unchanged", () => {
    expect(countryName(null)).toBe("");
    expect(countryName(undefined)).toBe("");
    expect(countryName("")).toBe("");
  });
});

describe("mapCardToTemFields", () => {
  it("renders nationality and country of entry as full names, not codes", () => {
    const f = mapCardToTemFields(base);
    expect(fieldValue(f.holder, "nationality")).toBe("Germany");
    expect(f.countryOfEntry.value).toBe("Sweden");
    expect(fieldValue(f.provider, "providerAddress")).toContain("Finland");
  });

  it("field 6 (passport / ID no.) is blank when the holder has no document number", () => {
    const f = mapCardToTemFields({
      ...base,
      cardHolder: { ...base.cardHolder, documentNumber: null },
    });
    const doc = f.holder.find((x) => x.key === "documentNumber")!;
    expect(doc.no).toBe(6);
    expect(doc.value).toBe("");
  });

  it("field 12 (country of entry) is blank when the holder is resident in Finland", () => {
    const f = mapCardToTemFields({
      ...base,
      cardHolder: { ...base.cardHolder, isResidentInFinland: true },
      countryOfEntryToFinland: null,
      countryOfEntryNotApplicableReason: "RESIDENT_IN_FINLAND",
    });
    expect(f.countryOfEntry.no).toBe(12);
    expect(f.countryOfEntry.value).toBe("");
  });

  it("Nordic citizens still state a country of entry (only residency blanks field 12)", () => {
    const f = mapCardToTemFields({
      ...base,
      cardHolder: { ...base.cardHolder, isResidentInFinland: false, citizenship: "SE" },
      countryOfEntryToFinland: "DK",
    });
    expect(f.countryOfEntry.value).toBe("Denmark");
  });

  it("renders identity as PIC when the holder has no date of birth", () => {
    const f = mapCardToTemFields({
      ...base,
      cardHolder: { ...base.cardHolder, dateOfBirth: null, finnishPersonalIdentityCode: "120490-1235" },
    });
    expect(fieldValue(f.holder, "picOrDob")).toBe("120490-1235");
  });

  it("always renders the departure date (no longer optional)", () => {
    const f = mapCardToTemFields({ ...base, departureDate: "2026-08-01" });
    expect(fieldValue(f.stay, "departureDate")).toBe("2026-08-01");
  });

  it("projects spouse/minor riders as name + PIC-or-DOB only, numbered from 7", () => {
    const f = mapCardToTemFields({
      ...base,
      accompanying: [
        { roleOnCard: "SPOUSE", firstName: "Ben", lastName: "Example", dateOfBirth: "1994-02-02" },
        {
          roleOnCard: "MINOR_CHILD",
          firstName: "Cara",
          lastName: "Example",
          dateOfBirth: null,
          finnishPersonalIdentityCode: "010115A002C",
        },
      ],
    });
    expect(f.family).toHaveLength(2);
    expect(f.family[0]).toMatchObject({ no: 7, surname: "Example", givenNames: "Ben", identity: "1994-02-02" });
    expect(f.family[1]).toMatchObject({ no: 8, identity: "010115A002C" });
  });

  it("never projects email/phone/countryOfResidence/documentType (data minimization)", () => {
    const f = mapCardToTemFields(base);
    const serialized = JSON.stringify(f).toLowerCase();
    for (const forbidden of ["email", "phone", "countryofresidence", "documenttype"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
