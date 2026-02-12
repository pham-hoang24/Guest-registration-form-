import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

import type { PdfTemplate, RegistrationSubmission } from "../../types.js";

const DEFAULT_TEMPLATE_ID = "default";
const DEFAULT_TEMPLATE_VERSION = 1;
const DEFAULT_TITLE = "Guest Registration";

export const defaultTemplateV1: PdfTemplate = {
  templateId: DEFAULT_TEMPLATE_ID,
  templateVersion: DEFAULT_TEMPLATE_VERSION,
  async render(submission: RegistrationSubmission) {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const margin = 48;
    let cursorY = height - margin;

    const content = JSON.stringify(submission, null, 2);
    const requiresUnicode = /[^\u0000-\u007f]/.test(content);

    const { font, fontSize } = await loadFont(pdfDoc, requiresUnicode);

    page.drawText(DEFAULT_TITLE, {
      x: margin,
      y: cursorY,
      size: 18,
      font,
      color: rgb(0, 0, 0)
    });
    cursorY -= 28;

    const lines = wrapText(content, font, fontSize, width - margin * 2);
    for (const line of lines) {
      if (cursorY < margin) {
        page = pdfDoc.addPage();
        cursorY = height - margin;
      }
      page.drawText(line, {
        x: margin,
        y: cursorY,
        size: fontSize,
        font,
        color: rgb(0, 0, 0)
      });
      cursorY -= fontSize + 4;
    }

    const pdfBytes = await pdfDoc.save();
    const buffer = Buffer.from(pdfBytes);
    return {
      pdfBytes: buffer,
      contentType: "application/pdf",
      contentLength: buffer.length
    };
  }
};

const loadFont = async (pdfDoc: PDFDocument, requiresUnicode: boolean) => {
  const base64Font = process.env.PDF_FONT_BASE64;
  const fontPath = process.env.PDF_FONT_PATH;
  if (base64Font || fontPath) {
    pdfDoc.registerFontkit(fontkit);
    const fontBytes = base64Font
      ? Buffer.from(base64Font, "base64")
      : await readFile(fontPath as string);
    const font = await pdfDoc.embedFont(fontBytes);
    return { font, fontSize: 11 };
  }
  if (requiresUnicode) {
    throw new Error("Unicode content requires PDF_FONT_BASE64 or PDF_FONT_PATH");
  }
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  return { font, fontSize: 11 };
};

const wrapText = (text: string, font: any, fontSize: number, maxWidth: number) => {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(next, fontSize);
    if (width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
};
