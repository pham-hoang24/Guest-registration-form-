import { defaultTemplateV1 } from "./templates/default/v1.js";
export const PDF_SCHEMA_VERSION = "1.0";
export class PdfTemplateRegistry {
    templates = new Map();
    constructor(templates = []) {
        templates.forEach((template) => this.register(template));
    }
    register(template) {
        const key = this.toKey(template.templateId, template.templateVersion);
        this.templates.set(key, template);
    }
    get(templateId, templateVersion) {
        const key = this.toKey(templateId, templateVersion);
        return this.templates.get(key) ?? null;
    }
    async render(submission, templateId, templateVersion) {
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
    toKey(templateId, templateVersion) {
        return `${templateId}@${templateVersion}`;
    }
}
export const defaultPdfTemplateRegistry = new PdfTemplateRegistry([defaultTemplateV1]);
