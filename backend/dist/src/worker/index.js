import { fileURLToPath } from "node:url";
export { processSubmissionJob } from "./processSubmission.js";
/**
 * Start the appropriate worker backend based on environment configuration.
 *
 * - SERVICE_BUS_NAMESPACE set → AzureServiceBusReceiver (production)
 * - SERVICE_BUS_NAMESPACE unset → InMemoryWorker (local dev / tests, no-op)
 *
 * Called only when this module is the process entry point so that importing
 * it from tests does NOT start a real worker.
 */
async function startWorker() {
    const { AzureServiceBusReceiver } = await import("../services/azureServiceBusReceiver.js");
    const { InMemoryWorker } = await import("../services/inMemoryWorker.js");
    const worker = process.env.SERVICE_BUS_NAMESPACE
        ? new AzureServiceBusReceiver()
        : new InMemoryWorker();
    const shutdown = async (signal) => {
        console.info(`[worker] Received ${signal}, shutting down...`);
        await worker.stop();
        process.exit(0);
    };
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("SIGINT", () => void shutdown("SIGINT"));
    await worker.start();
    console.info("[worker] Started.");
}
// Only run when executed directly, not when imported by tests or other modules.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    startWorker().catch((err) => {
        console.error("[worker] Fatal startup error:", err instanceof Error ? err.message : err);
        process.exit(1);
    });
}
