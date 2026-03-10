import { InMemoryQueue } from "./inMemoryQueue.js";
import { AzureServiceBusSender } from "./azureServiceBusSender.js";
/**
 * Active queue instance. Selects Azure Service Bus when SERVICE_BUS_NAMESPACE
 * is set; falls back to in-memory for local dev and tests.
 */
export const queue = process.env.SERVICE_BUS_NAMESPACE
    ? new AzureServiceBusSender()
    : new InMemoryQueue();
/**
 * Enqueue a submission job. Resolves once the job is accepted, not when the
 * PDF is ready (processing is asynchronous).
 */
export const enqueue = (job) => queue.enqueue(job);
