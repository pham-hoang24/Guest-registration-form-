import { processSubmissionJob } from "../worker/processSubmission.js";
import type { SubmissionJob } from "../worker/processSubmission.js";
import type { Queue } from "./queue.js";

// Module-level state. Private to this module — external code must use
// InMemoryQueue.enqueue() and InMemoryQueue.reset() to interact with the queue.
const jobQueue: SubmissionJob[] = [];
let drainScheduled = false;

function drain(): void {
  if (jobQueue.length === 0) {
    drainScheduled = false;
    return;
  }
  const job = jobQueue.shift()!;
  processSubmissionJob(job).catch((err) => {
    console.error("[in-memory-queue] processSubmissionJob failed:", err?.message ?? err);
  });
  if (jobQueue.length > 0) {
    setImmediate(drain);
  } else {
    drainScheduled = false;
  }
}

/**
 * In-memory queue for local development and tests.
 * Jobs are drained in the same process via setImmediate.
 * Not suitable for production — use AzureServiceBusSender instead.
 */
export class InMemoryQueue implements Queue {
  async enqueue(job: SubmissionJob): Promise<void> {
    jobQueue.push(job);
    if (!drainScheduled) {
      drainScheduled = true;
      setImmediate(drain);
    }
  }

  /**
   * Clears all pending jobs and resets the drain flag.
   * Call in test beforeEach to prevent stale jobs from bleeding across tests.
   * Mirrors the reset() pattern on InMemoryDb and InMemoryBlobStore.
   */
  reset(): void {
    jobQueue.length = 0;
    drainScheduled = false;
  }
}
