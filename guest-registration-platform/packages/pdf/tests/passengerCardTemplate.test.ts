import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

const EXPECTED_FIELDS = [
  "Text1",
  "Text2",
  "Text3",
  "Text4",
  "Text5",
  "Text6",
  "A1.0",
  "A1.1",
  "A1.2",
  "A1.3",
  "A1.4",
  "A2.0",
  "A2.1",
  "A2.2",
  "A2.3",
  "A2.4",
  "A3.0",
  "A3.1",
  "A3.2",
  "A3.3",
  "A3.4",
  "Text7",
  "Text8",
  "Text8b",
  "Check Box1",
  "Check Box2",
  "Check Box3",
  "Check Box4",
  "Check Box5",
  "Text9",
  "Text10",
  "Text11",
];

describe("official passenger card template", () => {
  it("contains expected AcroForm fields", async () => {
    const bytes = readFileSync(new URL("../templates/passenger-card.pdf", import.meta.url));
    const doc = await PDFDocument.load(bytes);
    const names = doc.getForm().getFields().map((f) => f.getName());

    expect(names).toHaveLength(EXPECTED_FIELDS.length);
    for (const name of EXPECTED_FIELDS) {
      expect(names).toContain(name);
    }
  });
});
