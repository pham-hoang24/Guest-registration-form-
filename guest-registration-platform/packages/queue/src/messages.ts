import { z } from "zod";

/**
 * Queue payload for a PDF generation job. Deliberately minimal: only lookup
 * keys, never guest data. The worker refetches everything scoped by
 * tenantId + propertyId, so a forged or corrupted message cannot make it
 * operate on another tenant's submission.
 */
export const pdfJobMessageSchema = z.object({
  tenantId: z.string().uuid(),
  propertyId: z.string().uuid(),
  submissionId: z.string().uuid(),
});

export type PdfJobMessage = z.infer<typeof pdfJobMessageSchema>;

export type PdfJobHandler = (message: PdfJobMessage) => Promise<void>;
