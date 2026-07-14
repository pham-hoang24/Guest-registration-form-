import { PURPOSES_OF_STAY } from "@gr/shared";
import { describe, expect, it } from "vitest";
import {
  assertMinimizationInvariants,
  computeSignaturePlacement,
  fillPassengerCardDocument,
  generatePassengerCardPdf,
  mapCardToTemFields,
  SIGNATURE_SAFE_ZONE,
  type RegistrationCardPdfInput,
} from "../src/index.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEUlEQVR4nGNgYGD4TwCPBAUAgkg/weiby3kAAAAASUVORK5CYII=",
  "base64",
);

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
  signaturePng: PNG,
  signedAt: new Date("2026-07-20T11:59:00Z"),
  generatedAt: new Date("2026-07-20T12:00:00Z"),
};

// Measured from `pdftotext -bbox` on packages/pdf/templates/passenger-card.pdf.
const SIGNATURE_LABEL_BOTTOM_Y = 198.7;
const PROVIDER_HEADER_TOP_Y = 157.5;

describe("signature safe zone geometry", () => {
  it("stays between the provider header and signature label", () => {
    expect(SIGNATURE_SAFE_ZONE.y).toBeGreaterThanOrEqual(PROVIDER_HEADER_TOP_Y);
    expect(SIGNATURE_SAFE_ZONE.y + SIGNATURE_SAFE_ZONE.height).toBeLessThanOrEqual(
      SIGNATURE_LABEL_BOTTOM_Y,
    );
  });

  it("keeps computed placement inside the safe zone", () => {
    const placement = computeSignaturePlacement(400, 120);
    expect(placement.x).toBeGreaterThanOrEqual(SIGNATURE_SAFE_ZONE.x);
    expect(placement.y).toBeGreaterThanOrEqual(SIGNATURE_SAFE_ZONE.y);
    expect(placement.x + placement.width).toBeLessThanOrEqual(
      SIGNATURE_SAFE_ZONE.x + SIGNATURE_SAFE_ZONE.width,
    );
    expect(placement.y + placement.height).toBeLessThanOrEqual(
      SIGNATURE_SAFE_ZONE.y + SIGNATURE_SAFE_ZONE.height,
    );
  });
});

describe("assertMinimizationInvariants", () => {
  it("throws when a non-resident non-Nordic holder has no document number", () => {
    const input: RegistrationCardPdfInput = {
      ...base,
      cardHolder: {
        ...base.cardHolder,
        citizenship: "AF",
        isResidentInFinland: false,
        documentNumber: null,
      },
    };
    const fields = mapCardToTemFields(input);
    expect(() => assertMinimizationInvariants(input, fields)).toThrow(/Field 6/);
  });

  it("allows a resident in Finland with Afghan nationality and blank fields 6 and 12", () => {
    const input: RegistrationCardPdfInput = {
      ...base,
      cardHolder: {
        ...base.cardHolder,
        citizenship: "AF",
        isResidentInFinland: true,
        documentNumber: null,
      },
      countryOfEntryToFinland: null,
      countryOfEntryNotApplicableReason: "RESIDENT_IN_FINLAND",
    };
    const fields = mapCardToTemFields(input);
    expect(() => assertMinimizationInvariants(input, fields)).not.toThrow();
  });

  it("allows a Nordic non-resident with no document number but country of entry filled", () => {
    const input: RegistrationCardPdfInput = {
      ...base,
      cardHolder: {
        ...base.cardHolder,
        citizenship: "SE",
        isResidentInFinland: false,
        documentNumber: null,
      },
      countryOfEntryToFinland: "DK",
    };
    const fields = mapCardToTemFields(input);
    expect(() => assertMinimizationInvariants(input, fields)).not.toThrow();
  });
});

describe("generatePassengerCardPdf", () => {
  it("produces a valid flattened PDF document", async () => {
    const bytes = await generatePassengerCardPdf(base);
    expect(bytes.length).toBeGreaterThan(5000);
    expect(Buffer.from(bytes.subarray(0, 5)).toString("ascii")).toBe("%PDF-");
  });

  it("fills holder surname and nationality before flatten", async () => {
    const doc = await fillPassengerCardDocument(base);
    const form = doc.getForm();
    expect(form.getTextField("Text1").getText()).toBe("Example");
    expect(form.getTextField("Text2").getText()).toBe("Anna");
    expect(form.getTextField("Text4").getText()).toBe("Germany");
    expect(form.getTextField("Text6").getText()).toBe("X1234567");
    expect(form.getCheckBox("Check Box1").isChecked()).toBe(true);
    expect(form.getCheckBox("Check Box5").isChecked()).toBe(false);
  });

  it("leaves field 6 blank for a Nordic citizen without a document number", async () => {
    const doc = await fillPassengerCardDocument({
      ...base,
      cardHolder: {
        ...base.cardHolder,
        citizenship: "SE",
        documentNumber: null,
      },
    });
    expect(doc.getForm().getTextField("Text6").getText() ?? "").toBe("");
  });

  it("leaves field 12 blank when the holder is resident in Finland", async () => {
    const doc = await fillPassengerCardDocument({
      ...base,
      cardHolder: {
        ...base.cardHolder,
        citizenship: "AF",
        isResidentInFinland: true,
        documentNumber: null,
      },
      countryOfEntryToFinland: null,
      countryOfEntryNotApplicableReason: "RESIDENT_IN_FINLAND",
    });
    expect(doc.getForm().getTextField("Text8b").getText() ?? "").toBe("");
  });

  it("rejects a non-resident non-Nordic holder missing document number", async () => {
    await expect(
      fillPassengerCardDocument({
        ...base,
        cardHolder: {
          ...base.cardHolder,
          citizenship: "AF",
          isResidentInFinland: false,
          documentNumber: null,
        },
      }),
    ).rejects.toThrow(/Field 6/);
  });

  it("fills accompanying family rows", async () => {
    const doc = await fillPassengerCardDocument({
      ...base,
      accompanying: [
        { roleOnCard: "SPOUSE", firstName: "Ben", lastName: "Example", dateOfBirth: "1994-02-02" },
      ],
    });
    const form = doc.getForm();
    expect(form.getTextField("A1.0").getText()).toBe("Example");
    expect(form.getTextField("A2.0").getText()).toBe("Ben");
    expect(form.getTextField("A3.0").getText()).toBe("1994-02-02");
  });

  it("ticks only the matching purpose checkbox and never Check Box5", async () => {
    for (const purpose of PURPOSES_OF_STAY) {
      const doc = await fillPassengerCardDocument({ ...base, purposeOfStay: purpose });
      const form = doc.getForm();
      expect(form.getCheckBox("Check Box5").isChecked()).toBe(false);

      const purposeBoxes = ["Check Box1", "Check Box2", "Check Box3", "Check Box4"] as const;
      const checked = purposeBoxes.filter((name) => form.getCheckBox(name).isChecked());
      expect(checked).toHaveLength(1);
    }
  });

  it("fills Unicode names via DejaVu field appearances", async () => {
    const doc = await fillPassengerCardDocument({
      ...base,
      cardHolder: { ...base.cardHolder, firstName: "Nguyễn", lastName: "Hoàng Åström" },
    });
    const form = doc.getForm();
    expect(form.getTextField("Text1").getText()).toBe("Hoàng Åström");
    expect(form.getTextField("Text2").getText()).toBe("Nguyễn");
    const bytes = await doc.save();
    expect(bytes.length).toBeGreaterThan(5000);
  });

  it("embeds the signature PNG without error", async () => {
    await expect(generatePassengerCardPdf(base)).resolves.toBeDefined();
  });
});
