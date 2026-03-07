/**
 * Azure Service Bus consumer for submission processing jobs.
 *
 * Infrastructure requirements:
 *   - Queue must have dead-lettering enabled
 *     (enableDeadLetteringOnMessageExpiration: true).
 *   - Set maxDeliveryCount on the queue to ≥ WORKER_MAX_ATTEMPTS + a buffer
 *     (e.g. app default = 5, set queue to 10 for headroom).
 *   - Message TTL should align with the max expected processing window (e.g. 24h).
 *   - The worker principal must have the "Azure Service Bus Data Receiver" role
 *     on the queue (principle of least privilege; do NOT grant Data Owner).
 *   - The API principal must have the "Azure Service Bus Data Sender" role only.
 */

import { ServiceBusClient, type ProcessErrorArgs } from "@azure/service-bus";
import { DefaultAzureCredential } from "@azure/identity";
import { processSubmissionJob, type SubmissionJob } from "../worker/processSubmission.js";
import type { QueueWorker } from "./queue.js";

/**
 * Accepts any RFC 4122 UUID (v1–v8) so the check remains valid if the
 * application later switches from UUIDv4 to UUIDv7 or another variant.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates the Service Bus namespace — matches the same rule enforced by
 * AzureServiceBusSender. Azure requires 6–50 character namespace names.
 */
const NAMESPACE_RE =
  /^[a-zA-Z][a-zA-Z0-9-]{4,48}[a-zA-Z0-9]\.servicebus\.windows\.net$/;

function isValidJob(body: unknown): body is SubmissionJob {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as Record<string, unknown>).submissionId === "string" &&
    UUID_RE.test((body as Record<string, unknown>).submissionId as string)
  );
}

/**
 * Azure Service Bus consumer.
 *
 * Uses peekLock mode — messages are explicitly completed on success or
 * abandoned on transient failure, allowing Service Bus to retry up to
 * maxDeliveryCount before moving to the dead-letter queue (DLQ).
 *
 * Malformed messages (invalid schema) are immediately dead-lettered to
 * avoid retry loops consuming the delivery count budget.
 *
 * IMPORTANT: Message bodies are never logged because submissionId is linked
 * to guest PII stored in the encrypted payload store.
 */
export class AzureServiceBusReceiver implements QueueWorker {
  private readonly client: ServiceBusClient;
  private readonly queueName: string;
  private receiver: ReturnType<ServiceBusClient["createReceiver"]> | null = null;

  constructor() {
    const namespace = process.env.SERVICE_BUS_NAMESPACE;
    const queueName = process.env.SERVICE_BUS_QUEUE;

    if (!namespace || !NAMESPACE_RE.test(namespace)) {
      throw new Error(
        "SERVICE_BUS_NAMESPACE is missing or invalid. " +
          "Expected format: your-namespace.servicebus.windows.net (6–50 char prefix)."
      );
    }
    if (!queueName || queueName.trim() === "") {
      throw new Error("SERVICE_BUS_QUEUE must be set to the queue name.");
    }

    this.client = new ServiceBusClient(namespace, new DefaultAzureCredential());
    this.queueName = queueName;
  }

  async start(): Promise<void> {
    if (this.receiver !== null) {
      throw new Error("AzureServiceBusReceiver.start() has already been called.");
    }
    this.receiver = this.client.createReceiver(this.queueName, { receiveMode: "peekLock" });

    this.receiver.subscribe({
      processMessage: async (message) => {
        // Validate shape before processing — malformed messages go straight to DLQ.
        if (!isValidJob(message.body)) {
          console.error(
            "[service-bus] Received message with invalid body shape; dead-lettering."
          );
          await this.receiver!.deadLetterMessage(message, {
            deadLetterReason: "invalid_message_format",
            deadLetterErrorDescription: "Body must contain a valid UUID submissionId."
          });
          return;
        }

        const { submissionId } = message.body;
        // submissionId is linked to guest PII — do not log it at any level so
        // that log aggregators cannot correlate it with error context or timing.
        console.info("[service-bus] Processing job.");

        try {
          await processSubmissionJob({ submissionId });
          await this.receiver!.completeMessage(message);
          console.info("[service-bus] Job completed.");
        } catch (err) {
          const reason = err instanceof Error ? err.message : "unknown_error";
          console.error(`[service-bus] Job processing failed: ${reason}; abandoning.`);
          await this.receiver!.abandonMessage(message);
        }
      },

      processError: async (args: ProcessErrorArgs) => {
        // Log the error source and message, but not the entity path in full
        // (it contains the queue name, which is not sensitive but also not needed).
        console.error(
          `[service-bus] Receive error from ${args.errorSource}:`,
          args.error instanceof Error ? args.error.message : String(args.error)
        );
      }
    });
  }

  async stop(): Promise<void> {
    await this.receiver?.close();
    await this.client.close();
  }
}
