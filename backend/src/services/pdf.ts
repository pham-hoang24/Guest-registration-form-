import { defaultPdfTemplateRegistry } from "../pdf/registry.js";
import type { RegistrationSubmission } from "../pdf/types.js";

export const DEFAULT_TEMPLATE_ID = "default";
export const DEFAULT_TEMPLATE_VERSION = 1;

export const generatePdf = async (
  payload: RegistrationSubmission,
  templateId: string = DEFAULT_TEMPLATE_ID,
  templateVersion: number = DEFAULT_TEMPLATE_VERSION
) => {
  return defaultPdfTemplateRegistry.render(payload, templateId, templateVersion);
};
