export * from "./messages.js";
export * from "./producer.js";
export * from "./consumer.js";
// azureServiceBus.js is loaded lazily via queueProducerFromEnv / startAzurePdfJobConsumer
// so local dev never initialises the Service Bus SDK.

/**
 * Lazy wrapper for the Azure Service Bus consumer. Dynamically imports the
 * Azure SDK so that importing @gr/queue in local dev or tests never loads it.
 * Call this from the worker process entrypoint, not from the API.
 */
export async function startAzurePdfJobConsumer(args: {
  connectionString: string;
  queueName: string;
  maxDeliveryCount: number;
  handler: import("./messages.js").PdfJobHandler;
  log?: (entry: Record<string, unknown>) => void;
}): Promise<{ close(): Promise<void> }> {
  const { startPdfJobConsumer } = await import("./azureServiceBus.js");
  return startPdfJobConsumer(args);
}
