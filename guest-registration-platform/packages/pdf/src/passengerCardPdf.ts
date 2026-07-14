import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { assertMinimizationInvariants, mapCardToTemFields, type TemCardFields } from "./temFieldMap.js";
import type { RegistrationCardPdfInput } from "./registrationPdf.js";
import { trimTransparentPadding } from "./signatureImage.js";

const TEMPLATE_BYTES = readFileSync(new URL("../templates/passenger-card.pdf", import.meta.url));
const FONT_REGULAR = readFileSync(new URL("../assets/DejaVuSans.ttf", import.meta.url));

const PURPOSE_CHECKBOX: Record<string, string> = {
  Leisure: "Check Box1",
  Business: "Check Box2",
  Meeting: "Check Box3",
  Other: "Check Box4",
};

/**
 * Signature safe zone, verified against the template via `pdftotext -bbox`
 * (see docs/pdf-generation.md). Bounded by the signature-label line's bottom
 * edge (~198.7) above and the provider-section header's top edge (~157.5)
 * below; must never be widened without re-verifying against the template.
 */
export const SIGNATURE_SAFE_ZONE = { x: 60, y: 160, width: 240, height: 36 };

const SIGNATURE_MAX_WIDTH = SIGNATURE_SAFE_ZONE.width * 0.85;
const SIGNATURE_MAX_HEIGHT = SIGNATURE_SAFE_ZONE.height * 0.65;

export type SignaturePlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Computes centered signature placement within the verified safe zone. */
export function computeSignaturePlacement(
  pngWidth: number,
  pngHeight: number,
): SignaturePlacement {
  const scale = Math.min(SIGNATURE_MAX_WIDTH / pngWidth, SIGNATURE_MAX_HEIGHT / pngHeight);
  const width = pngWidth * scale;
  const height = pngHeight * scale;
  const x = SIGNATURE_SAFE_ZONE.x;
  const y = SIGNATURE_SAFE_ZONE.y + (SIGNATURE_SAFE_ZONE.height - height) / 2;
  return { x, y, width, height };
}

function holderValue(fields: TemCardFields, key: string): string {
  return fields.holder.find((f) => f.key === key)?.value ?? "";
}

function providerValue(fields: TemCardFields, key: string): string {
  return fields.provider.find((f) => f.key === key)?.value ?? "";
}

function stayValue(fields: TemCardFields, key: string): string {
  return fields.stay.find((f) => f.key === key)?.value ?? "";
}

/**
 * Loads the official TEM AcroForm template, fills fields from the card model,
 * and overlays the guest signature. Returns the document before flattening so
 * tests can read field values.
 */
export async function fillPassengerCardDocument(
  input: RegistrationCardPdfInput,
): Promise<PDFDocument> {
  const doc = await PDFDocument.load(TEMPLATE_BYTES);
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(FONT_REGULAR, { subset: true });

  const form = doc.getForm();
  const fields = mapCardToTemFields(input);
  assertMinimizationInvariants(input, fields);

  form.getTextField("Text1").setText(holderValue(fields, "surname"));
  form.getTextField("Text2").setText(holderValue(fields, "givenNames"));
  form.getTextField("Text3").setText(holderValue(fields, "picOrDob"));
  form.getTextField("Text4").setText(holderValue(fields, "nationality"));
  form.getTextField("Text5").setText(holderValue(fields, "address"));
  form.getTextField("Text6").setText(holderValue(fields, "documentNumber"));

  fields.family.forEach((rider, i) => {
    form.getTextField(`A1.${i}`).setText(rider.surname);
    form.getTextField(`A2.${i}`).setText(rider.givenNames);
    form.getTextField(`A3.${i}`).setText(rider.identity);
  });

  form.getTextField("Text7").setText(stayValue(fields, "arrivalDate"));
  form.getTextField("Text8").setText(stayValue(fields, "departureDate"));
  form.getTextField("Text8b").setText(fields.countryOfEntry.value);

  const purposeBox = PURPOSE_CHECKBOX[input.purposeOfStay];
  if (purposeBox) {
    form.getCheckBox(purposeBox).check();
  }

  // Check Box5 sits beside the marketing-prohibition notice on the template,
  // not a consent field — leave it unchecked (legal semantics never confirmed).

  form.getTextField("Text9").setText(providerValue(fields, "providerName"));
  form.getTextField("Text10").setText(providerValue(fields, "providerBusinessId"));
  form.getTextField("Text11").setText(providerValue(fields, "providerAddress"));

  form.updateFieldAppearances(font);

  const page = doc.getPages()[0];
  if (!page) {
    throw new Error("Passenger card template has no pages");
  }

  const trimmed = trimTransparentPadding(input.signaturePng);
  const png = await doc.embedPng(trimmed);
  const placement = computeSignaturePlacement(png.width, png.height);
  page.drawImage(png, placement);

  return doc;
}

/** Fills the official TEM template and returns flattened PDF bytes in memory. */
export async function generatePassengerCardPdf(
  input: RegistrationCardPdfInput,
): Promise<Uint8Array> {
  const doc = await fillPassengerCardDocument(input);
  doc.getForm().flatten();
  return doc.save();
}
