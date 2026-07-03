import { ServiceBusClient, type ServiceBusReceiver, type ServiceBusSender } from "@azure/service-bus";
import { processPdfJobDelivery } from "./consumer.js";
import type { PdfJobHandler, PdfJobMessage } from "./messages.js";
import type { QueueProducer } from "./producer.js";

export const DEFAULT_PDF_QUEUE_NAME = "pdf-jobs";
export const DEFAULT_MAX_DELIVERY_COUNT = 5;

function requireConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString = env.AZURE_SERVICE_BUS_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error(
      "AZURE_SERVICE_BUS_CONNECTION_STRING must be set for QUEUE_PROVIDER=azure-service-bus",
    );
  }
  return connectionString;
}

export class AzureServiceBusQueueProducer implements QueueProducer {
  private readonly client: ServiceBusClient;
  private readonly sender: ServiceBusSender;

  constructor(connectionString: string, queueName: string) {
    this.client = new ServiceBusClient(connectionString);
    this.sender = this.client.createSender(queueName);
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): AzureServiceBusQueueProducer {
    return new AzureServiceBusQueueProducer(
      requireConnectionString(env),
      env.PDF_QUEUE_NAME ?? DEFAULT_PDF_QUEUE_NAME,
    );
  }

  async enqueuePdfJob(message: PdfJobMessage): Promise<void> {
    await this.sender.sendMessages({ body: message, contentType: "application/json" });
  }

  async close(): Promise<void> {
    await this.sender.close();
    await this.client.close();
  }
}

export type PdfJobConsumer = { close(): Promise<void> };

/**
 * Subscribes to the PDF job queue with peek-lock delivery. Settlement follows
 * processPdfJobDelivery: complete on success, abandon (retry) on transient
 * failure, dead-letter on poison. Keep the queue's own MaxDeliveryCount at or
 * above maxDeliveryCount so our explicit dead-lettering wins over the
 * broker's.
 */
export function startPdfJobConsumer(args: {
  connectionString: string;
  queueName: string;
  maxDeliveryCount: number;
  handler: PdfJobHandler;
  log?: (entry: Record<string, unknown>) => void;
}): PdfJobConsumer {
  const log = args.log ?? ((entry) => console.log(JSON.stringify(entry)));
  const client = new ServiceBusClient(args.connectionString);
  const receiver: ServiceBusReceiver = client.createReceiver(args.queueName, {
    receiveMode: "peekLock",
  });

  receiver.subscribe(
    {
      async processMessage(message) {
        const result = await processPdfJobDelivery({
          body: message.body,
          deliveryCount: message.deliveryCount ?? 1,
          maxDeliveryCount: args.maxDeliveryCount,
          handler: args.handler,
        });
        log({
          level: result.outcome === "completed" ? "info" : "warn",
          queue: args.queueName,
          outcome: result.outcome,
          ...("reason" in result ? { reason: result.reason } : {}),
          deliveryCount: message.deliveryCount ?? 1,
        });
        switch (result.outcome) {
          case "completed":
            await receiver.completeMessage(message);
            break;
          case "retry":
            await receiver.abandonMessage(message);
            break;
          case "dead_letter":
            await receiver.deadLetterMessage(message, {
                deadLetterReason: result.reason,
                deadLetterErrorDescription: result.reason,
              });
            break;
        }
      },
      async processError(errorArgs) {
        log({
          level: "error",
          queue: args.queueName,
          error: errorArgs.error.name,
          source: errorArgs.errorSource,
        });
      },
    },
    { autoCompleteMessages: false },
  );

  return {
    async close() {
      await receiver.close();
      await client.close();
    },
  };
}
