import { defaultPdfTemplateRegistry } from "../pdf/registry.js";
export const DEFAULT_TEMPLATE_ID = "default";
export const DEFAULT_TEMPLATE_VERSION = 1;
export const generatePdf = async (payload, templateId = DEFAULT_TEMPLATE_ID, templateVersion = DEFAULT_TEMPLATE_VERSION) => {
    return defaultPdfTemplateRegistry.render(payload, templateId, templateVersion);
};
