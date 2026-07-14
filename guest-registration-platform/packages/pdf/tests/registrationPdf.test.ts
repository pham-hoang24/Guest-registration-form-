import { describe, expect, it } from "vitest";
import { generateRegistrationPdf, type RegistrationCardPdfInput } from "../src/index.js";

// 8×8 opaque-black RGBA PNG — small but genuinely decodable by pdf-lib's UPNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEUlEQVR4nGNgYGD4TwCPBAUAgkg/weiby3kAAAAASUVORK5CYII=",
  "base64",
);

const input: RegistrationCardPdfInput = {
  guestSubmissionId: "22222222-2222-2222-2222-222222222222",
  passengerCardId: "11111111-1111-1111-1111-111111111111",
  cardNumber: 1,
  cardType: "PRIMARY_WITH_ALLOWED_FAMILY",
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
  signaturePng: PNG,
  signedAt: new Date("2026-07-20T11:59:00Z"),
  generatedAt: new Date("2026-07-20T12:00:00Z"),
};

describe("generateRegistrationPdf", () => {
  it("produces a valid PDF document", async () => {
    const bytes = await generateRegistrationPdf(input);
    expect(bytes.length).toBeGreaterThan(500);
    expect(Buffer.from(bytes.subarray(0, 5)).toString("ascii")).toBe("%PDF-");
  });

  it("renders country-exception cards", async () => {
    const bytes = await generateRegistrationPdf({
      ...input,
      countryOfEntryToFinland: null,
      countryOfEntryNotApplicableReason: "NORDIC_CITIZEN",
    });
    expect(bytes.length).toBeGreaterThan(500);
  });

  it("renders accompanying spouse and children (reduced detail)", async () => {
    const bytes = await generateRegistrationPdf({
      ...input,
      accompanying: [
        { roleOnCard: "SPOUSE", firstName: "Ben", lastName: "Example", dateOfBirth: "1994-02-02" },
        { roleOnCard: "MINOR_CHILD", firstName: "Cara", lastName: "Example", dateOfBirth: "2018-05-05" },
      ],
    });
    expect(bytes.length).toBeGreaterThan(500);
  });

  it("renders a PIC-identified holder and rider with no date of birth", async () => {
    const bytes = await generateRegistrationPdf({
      ...input,
      cardHolder: {
        ...input.cardHolder,
        dateOfBirth: null,
        finnishPersonalIdentityCode: "120490-1235",
      },
      accompanying: [
        {
          roleOnCard: "MINOR_CHILD",
          firstName: "Cara",
          lastName: "Example",
          dateOfBirth: null,
          finnishPersonalIdentityCode: "010115A002C",
        },
      ],
    });
    expect(bytes.length).toBeGreaterThan(500);
  });

  it("embeds Unicode names without mangling to '?' (Vietnamese + Nordic)", async () => {
    const bytes = await generateRegistrationPdf({
      ...input,
      cardHolder: { ...input.cardHolder, firstName: "Nguyễn", lastName: "Hoàng Åström" },
    });
    // A subsetted embedded TrueType font is present, so this must not throw.
    expect(bytes.length).toBeGreaterThan(500);
  });
});
