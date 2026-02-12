import { processSubmissionJob } from "../worker/processSubmission.js";

/**
 * Job type: only submissionId. Payload is loaded by the worker from the payload store.
 * Real queue implementations (Redis, SQS, etc.) should push only this small message;
 * request must not block on PDF generation.
 */
export type SubmissionJob = { submissionId: string };

const jobQueue: SubmissionJob[] = [];
let drainScheduled = false;

function drain(): void {
  if (jobQueue.length === 0) {
    drainScheduled = false;
    return;
  }
  const job = jobQueue.shift()!;
  processSubmissionJob(job).catch((err) => {
    console.error("[queue] processSubmissionJob failed:", err?.message ?? err);
  });
  if (jobQueue.length > 0) {
    setImmediate(drain);
  } else {
    drainScheduled = false;
  }
}

/**
 * Enqueue a submission job. Resolves once the job is accepted (queued), not when PDF is ready.
 * MVP: in-process queue + background drain. Swap for Redis/SQS later with same signature.
 */
export async function enqueue(job: SubmissionJob): Promise<void> {
  jobQueue.push(job);
  if (!drainScheduled) {
    drainScheduled = true;
    setImmediate(drain);
  }
}
