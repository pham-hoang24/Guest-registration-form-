import type { PdfJobHandler, PdfJobMessage } from "./messages.js";

/** Transport abstraction the API uses to hand off PDF generation. */
export interface QueueProducer {
  enqueuePdfJob(message: PdfJobMessage): Promise<void>;
}

/**
 * Dev/test transport: runs the job inline in the calling process. Errors
 * propagate to the caller (which logs them); there are no retries — the
 * job itself already marks the submission FAILED and audit-logs.
 */
export class InProcessQueueProducer implements QueueProducer {
  constructor(private readonly handler: PdfJobHandler) {}

  async enqueuePdfJob(message: PdfJobMessage): Promise<void> {
    await this.handler(message);
  }
}

export async function queueProducerFromEnv(
  env: NodeJS.ProcessEnv,
  args: { inProcessHandler: PdfJobHandler },
): Promise<QueueProducer> {
  const provider = env.QUEUE_PROVIDER ?? "in-process";
  if (provider === "in-process") {
    return new InProcessQueueProducer(args.inProcessHandler);
  }
  if (provider === "azure-service-bus") {
    const { AzureServiceBusQueueProducer } = await import("./azureServiceBus.js");
    return AzureServiceBusQueueProducer.fromEnv(env);
  }
  throw new Error(`Unsupported QUEUE_PROVIDER: ${provider}`);
}
