export type RegistrationSubmission = Record<string, unknown>;

export type PdfTemplateRenderResult = {
  pdfBytes: Buffer;
  contentType: "application/pdf";
  contentLength: number;
};

export type PdfTemplate = {
  templateId: string;
  templateVersion: number;
  render(submission: RegistrationSubmission): Promise<PdfTemplateRenderResult>;
};
