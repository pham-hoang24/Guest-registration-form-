import { InMemoryQueue } from "./inMemoryQueue.js";
import { AzureServiceBusSender } from "./azureServiceBusSender.js";

/**
 * Producer interface: submit a job to the queue.
 * Implementations: InMemoryQueue (local/tests), AzureServiceBusSender (production).
 */
export interface Queue {
  enqueue(job: { submissionId: string }): Promise<void>;
}

/**
 * Consumer interface: start/stop processing jobs from the queue.
 * Implementations: InMemoryWorker (local/tests), AzureServiceBusReceiver (production).
 */
export interface QueueWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Active queue instance. Selects Azure Service Bus when SERVICE_BUS_NAMESPACE
 * is set; falls back to in-memory for local dev and tests.
 */
export const queue: Queue = process.env.SERVICE_BUS_NAMESPACE
  ? new AzureServiceBusSender()
  : new InMemoryQueue();

/**
 * Enqueue a submission job. Resolves once the job is accepted, not when the
 * PDF is ready (processing is asynchronous).
 */
export const enqueue = (job: { submissionId: string }): Promise<void> =>
  queue.enqueue(job);
