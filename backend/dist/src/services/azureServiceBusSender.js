import { ServiceBusClient } from "@azure/service-bus";
import { DefaultAzureCredential } from "@azure/identity";
/**
 * Validates the Service Bus namespace to prevent SSRF / misconfiguration.
 * Must be in the form "your-namespace.servicebus.windows.net".
 */
/**
 * Azure requires namespace names to be 6–50 characters (letters, digits, hyphens).
 * The regex enforces this: 1 leading letter + 4–48 middle chars + 1 trailing alnum = 6–50 total.
 */
const NAMESPACE_RE = /^[a-zA-Z][a-zA-Z0-9-]{4,48}[a-zA-Z0-9]\.servicebus\.windows\.net$/;
/**
 * Azure Service Bus producer.
 *
 * Authenticates via Managed Identity (DefaultAzureCredential) — no shared
 * connection string is stored. The principal running the API must have the
 * "Azure Service Bus Data Sender" role on the queue.
 *
 * A new client is created per message because message throughput for this
 * service is low (one per guest registration). For high-throughput scenarios,
 * maintain a long-lived client.
 */
export class AzureServiceBusSender {
    namespace;
    queueName;
    constructor() {
        const namespace = process.env.SERVICE_BUS_NAMESPACE;
        const queueName = process.env.SERVICE_BUS_QUEUE;
        if (!namespace || !NAMESPACE_RE.test(namespace)) {
            throw new Error("SERVICE_BUS_NAMESPACE is missing or invalid. " +
                "Expected format: your-namespace.servicebus.windows.net");
        }
        if (!queueName || queueName.trim() === "") {
            throw new Error("SERVICE_BUS_QUEUE must be set to the queue name.");
        }
        this.namespace = namespace;
        this.queueName = queueName;
    }
    async enqueue(job) {
        const client = new ServiceBusClient(this.namespace, new DefaultAzureCredential());
        const sender = client.createSender(this.queueName);
        try {
            await sender.sendMessages({
                body: { submissionId: job.submissionId },
                contentType: "application/json",
                subject: "submission_job"
            });
        }
        finally {
            // Close independently so a failure in sender.close() doesn't leave the
            // AMQP client connection open indefinitely.
            await sender.close().catch(() => { });
            await client.close().catch(() => { });
        }
    }
}
