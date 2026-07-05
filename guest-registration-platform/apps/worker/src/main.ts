// Environment is loaded by dotenv-cli (`dotenv -e ../../.env -- tsx src/main.ts`)
// so process.env is fully populated before any import side-effects run.
export {};

const [
  { getDb, disconnectDb },
  { kmsProviderFromEnv },
  storagePkg,
  { generatePdfForPassengerCard },
  { runRetentionCleanup },
  { startAzurePdfJobConsumer },
] = await Promise.all([
  import("@gr/db"),
  import("@gr/crypto"),
  import("@gr/storage"),
  import("./generatePdfForPassengerCard.js"),
  import("./retention.js"),
  import("@gr/queue"),
]);

const connectionString = process.env.AZURE_SERVICE_BUS_CONNECTION_STRING;
if (!connectionString) {
  throw new Error("AZURE_SERVICE_BUS_CONNECTION_STRING must be set to run the worker");
}

const queueName = process.env.PDF_QUEUE_NAME ?? "pdf-jobs";
const maxDeliveryCount = Number(process.env.PDF_JOB_MAX_DELIVERY_COUNT ?? "5");
const retentionIntervalHours = Number(process.env.RETENTION_INTERVAL_HOURS ?? "24");
const storageProviderName = process.env.STORAGE_PROVIDER ?? "local";

const db = getDb();
const [kms, storage] = await Promise.all([
  kmsProviderFromEnv(),
  storagePkg.storageProviderFromEnv(),
]);
const workerDeps = { db, kms, storage, storageProviderName };

console.log(JSON.stringify({ level: "info", event: "worker_starting", queueName }));

const consumer = await startAzurePdfJobConsumer({
  connectionString,
  queueName,
  maxDeliveryCount,
  handler: (msg) => generatePdfForPassengerCard(msg, workerDeps),
});

async function runRetention() {
  try {
    const result = await runRetentionCleanup({ db, storage });
    console.log(
      JSON.stringify({
        level: "info",
        event: "retention_complete",
        deleted: result.deletedSubmissionIds.length,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "retention_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  }
}

await runRetention();
const retentionTimer = setInterval(() => void runRetention(), retentionIntervalHours * 60 * 60 * 1000);

async function shutdown(signal: string) {
  console.log(JSON.stringify({ level: "info", event: "worker_stopping", signal }));
  clearInterval(retentionTimer);
  await consumer.close();
  await disconnectDb();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log(JSON.stringify({ level: "info", event: "worker_started", queueName }));
