import type { PdfTemplate, PdfTemplateRenderResult, RegistrationSubmission } from "./types.js";
import { defaultTemplateV1 } from "./templates/default/v1.js";

export const PDF_SCHEMA_VERSION = "1.0";

type TemplateKey = `${string}@${number}`;

export class PdfTemplateRegistry {
  private templates = new Map<TemplateKey, PdfTemplate>();

  constructor(templates: PdfTemplate[] = []) {
    templates.forEach((template) => this.register(template));
  }

  register(template: PdfTemplate) {
    const key = this.toKey(template.templateId, template.templateVersion);
    this.templates.set(key, template);
  }

  get(templateId: string, templateVersion: number) {
    const key = this.toKey(templateId, templateVersion);
    return this.templates.get(key) ?? null;
  }

  async render(
    submission: RegistrationSubmission,
    templateId: string,
    templateVersion: number
  ): Promise<
    PdfTemplateRenderResult & {
      templateId: string;
      templateVersion: number;
      pdfSchemaVersion: string;
    }
  > {
    const template = this.get(templateId, templateVersion);
    if (!template) {
      throw new Error(`PDF template not found: ${templateId}@${templateVersion}`);
    }
    const result = await template.render(submission);
    return {
      ...result,
      templateId: template.templateId,
      templateVersion: template.templateVersion,
      pdfSchemaVersion: PDF_SCHEMA_VERSION
    };
  }

  private toKey(templateId: string, templateVersion: number): TemplateKey {
    return `${templateId}@${templateVersion}`;
  }
}

export const defaultPdfTemplateRegistry = new PdfTemplateRegistry([defaultTemplateV1]);
