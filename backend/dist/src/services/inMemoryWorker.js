/**
 * In-memory worker for local development and tests.
 *
 * The InMemoryQueue drives its own drain loop on each enqueue() call,
 * so this class has no work to do. It exists only to satisfy the QueueWorker
 * interface so the worker entry point can use a uniform start/stop API
 * regardless of which backend is configured.
 */
export class InMemoryWorker {
    async start() {
        // No-op: drain is triggered automatically by InMemoryQueue.enqueue().
    }
    async stop() {
        // No-op: no background resources to release.
    }
}
