import { pdfJobMessageSchema, type PdfJobHandler } from "./messages.js";

export type PdfJobOutcome =
  | { outcome: "completed" }
  /** Transient failure below the delivery cap: message goes back on the queue. */
  | { outcome: "retry"; reason: string }
  /** Poison message: parked on the dead-letter queue for operator inspection. */
  | { outcome: "dead_letter"; reason: string };

function errorName(error: unknown): string {
  // Error *names* only — messages may echo data we do not want in logs.
  return error instanceof Error ? error.name : "UnknownError";
}

/**
 * Transport-independent retry/poison decision for one queue delivery.
 * `deliveryCount` is 1-based (Service Bus semantics: 1 = first attempt).
 *
 * - Unparseable bodies are poison immediately — retrying cannot fix them.
 * - Handler failures retry until the delivery cap, then dead-letter. The job
 *   itself marks the submission FAILED and audit-logs on every failed
 *   attempt, so a dead-lettered job is already visible in the dashboard.
 */
export async function processPdfJobDelivery(args: {
  body: unknown;
  deliveryCount: number;
  maxDeliveryCount: number;
  handler: PdfJobHandler;
}): Promise<PdfJobOutcome> {
  const parsed = pdfJobMessageSchema.safeParse(args.body);
  if (!parsed.success) {
    return { outcome: "dead_letter", reason: "invalid_message_body" };
  }

  try {
    await args.handler(parsed.data);
    return { outcome: "completed" };
  } catch (error) {
    if (args.deliveryCount >= args.maxDeliveryCount) {
      return { outcome: "dead_letter", reason: errorName(error) };
    }
    return { outcome: "retry", reason: errorName(error) };
  }
}
