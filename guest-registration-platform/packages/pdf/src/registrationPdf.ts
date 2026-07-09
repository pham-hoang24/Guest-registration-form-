import { readFileSync } from "node:fs";
import { PDFDocument, rgb, type PDFFont, type PDFImage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { mapCardToTemFields, type TemField } from "./temFieldMap.js";

// Bundled DejaVu Sans covers Latin Extended Additional (Vietnamese) and the
// Nordic characters (å ä ö ø) that the WinAnsi standard fonts mangle to "?".
const FONT_REGULAR = readFileSync(new URL("../assets/DejaVuSans.ttf", import.meta.url));
const FONT_BOLD = readFileSync(new URL("../assets/DejaVuSans-Bold.ttf", import.meta.url));

/** One person on the card. Only the card holder carries the full detail set. */
export type RegistrationPdfPerson = {
  roleOnCard: string;
  firstName: string;
  lastName: string;
  /** Null on the PIC path; identity is PIC-or-DOB, exactly one is present. */
  dateOfBirth: string | null;
  citizenship?: string | null;
  isResidentInFinland?: boolean | null;
  address?: string | null;
  documentNumber?: string | null;
  finnishPersonalIdentityCode?: string | null;
};

export type RegistrationCardPdfInput = {
  guestSubmissionId: string;
  passengerCardId: string;
  cardNumber: number;
  cardType: string;
  requirementVersion: string;
  property: {
    name: string;
    addressLine1: string;
    addressLine2?: string | null;
    postalCode: string;
    city: string;
    countryCode: string;
    businessId?: string | null;
  };
  arrivalDate: string;
  departureDate: string | null;
  departureDateKnown: boolean;
  purposeOfStay: string;
  countryOfEntryToFinland: string | null;
  countryOfEntryNotApplicableReason: string | null;
  /** Full-detail card holder (the primary guest or the additional adult). */
  cardHolder: RegistrationPdfPerson;
  /** Reduced entries (name + DOB only): spouse and minor children. */
  accompanying: RegistrationPdfPerson[];
  /** Decoded PNG signature bytes. */
  signaturePng: Uint8Array;
  signedAt: Date;
  generatedAt: Date;
};

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const BODY_SIZE = 10;
const LINE_HEIGHT = 15;

/**
 * Renders one draft passenger card PDF entirely in memory from a configured
 * template (legal review pending — see CLAUDE.md invariant 10).
 * The returned bytes must never be written to disk unencrypted.
 */
export async function generateRegistrationPdf(input: RegistrationCardPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(FONT_REGULAR, { subset: true });
  const bold = await doc.embedFont(FONT_BOLD, { subset: true });

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const newPageIfNeeded = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };

  const drawText = (text: string, options?: { font?: PDFFont; size?: number }) => {
    newPageIfNeeded(LINE_HEIGHT);
    page.drawText(clean(text), {
      x: MARGIN,
      y,
      size: options?.size ?? BODY_SIZE,
      font: options?.font ?? font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= LINE_HEIGHT;
  };

  const drawSectionRule = () => {
    newPageIfNeeded(LINE_HEIGHT);
    page.drawLine({
      start: { x: MARGIN, y: y + 4 },
      end: { x: PAGE_WIDTH - MARGIN, y: y + 4 },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    });
    y -= 8;
  };

  // Render numbered fields as "n  Label: value"; a blank value keeps the field
  // present (an intentionally empty box) so the draft card layout stays stable.
  const drawTemField = (field: TemField) => {
    newPageIfNeeded(LINE_HEIGHT);
    page.drawText(clean(`${field.no}  ${field.label}:`), {
      x: MARGIN,
      y,
      size: BODY_SIZE,
      font: bold,
      color: rgb(0.1, 0.1, 0.1),
    });
    page.drawText(clean(field.value), {
      x: MARGIN + 200,
      y,
      size: BODY_SIZE,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= LINE_HEIGHT;
  };

  const fields = mapCardToTemFields(input);

  drawText("Passenger Registration Card", { font: bold, size: 18 });
  y -= 2;
  // Never claim this is an official / authority-ready / legally-compliant form
  // (CLAUDE.md invariant 10). It is a draft generated from a configured template.
  drawText("DRAFT — generated from a configured template; legal review pending.", {
    font: bold,
    size: 9,
  });
  drawText(`Card ${input.cardNumber} — ${cardTypeLabel(input.cardType)}`, { size: 9 });
  drawText(`Requirement version: ${input.requirementVersion}`, { size: 9 });
  drawText(`Card ID: ${input.passengerCardId}`, { size: 9 });
  drawText(`Batch ID: ${input.guestSubmissionId}`, { size: 9 });
  y -= 8;

  drawText("Card Holder", { font: bold, size: 12 });
  drawSectionRule();
  fields.holder.forEach(drawTemField);
  y -= 8;

  if (fields.family.length > 0) {
    drawText("Accompanying Persons (spouse / minor children)", { font: bold, size: 12 });
    drawSectionRule();
    fields.family.forEach((rider) => {
      const identity = rider.identity ? ` (${rider.identity})` : "";
      drawTemField({
        no: rider.no,
        key: "familyRider",
        label: "Name",
        value: `${rider.surname} ${rider.givenNames}${identity}`.trim(),
      });
    });
    y -= 8;
  }

  drawText("Entry & Stay", { font: bold, size: 12 });
  drawSectionRule();
  drawTemField(fields.countryOfEntry);
  fields.stay.forEach(drawTemField);
  y -= 8;

  // Signature (field 16): draw image scaled to a fixed box, then the timestamp.
  drawText("16  Signature", { font: bold, size: 12 });
  drawSectionRule();
  const png: PDFImage = await doc.embedPng(input.signaturePng);
  const boxW = 200;
  const scaled = png.scaleToFit(boxW, 80);
  newPageIfNeeded(scaled.height + LINE_HEIGHT);
  page.drawImage(png, { x: MARGIN, y: y - scaled.height, width: scaled.width, height: scaled.height });
  y -= scaled.height + 6;
  drawText(`Signed: ${input.signedAt.toISOString()}`, { size: 9 });
  y -= 8;

  drawText("Accommodation Provider", { font: bold, size: 12 });
  drawSectionRule();
  fields.provider.forEach(drawTemField);
  y -= 8;

  drawText("Confirmation", { font: bold, size: 12 });
  drawSectionRule();
  drawText("The card holder confirmed the accuracy of the provided information and accepted the");
  drawText("privacy notice at the time of submission.");
  y -= 8;
  drawText(`Generated: ${input.generatedAt.toISOString()}`, { size: 9 });

  return doc.save();
}

function cardTypeLabel(cardType: string): string {
  if (cardType === "ADDITIONAL_ADULT_INDIVIDUAL") return "Additional adult";
  return "Primary + family";
}

/** Strip control characters that would break layout; the embedded font handles the rest. */
function clean(text: string): string {
  return text.replace(/[\r\n\t]/g, " ");
}
