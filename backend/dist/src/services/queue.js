import { processSubmissionJob } from "../worker/processSubmission.js";
const jobQueue = [];
let drainScheduled = false;
function drain() {
    if (jobQueue.length === 0) {
        drainScheduled = false;
        return;
    }
    const job = jobQueue.shift();
    processSubmissionJob(job).catch((err) => {
        console.error("[queue] processSubmissionJob failed:", err?.message ?? err);
    });
    if (jobQueue.length > 0) {
        setImmediate(drain);
    }
    else {
        drainScheduled = false;
    }
}
/**
 * Enqueue a submission job. Resolves once the job is accepted (queued), not when PDF is ready.
 * MVP: in-process queue + background drain. Swap for Redis/SQS later with same signature.
 */
export async function enqueue(job) {
    jobQueue.push(job);
    if (!drainScheduled) {
        drainScheduled = true;
        setImmediate(drain);
    }
}
