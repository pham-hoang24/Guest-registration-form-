import path from "node:path";
import dotenv from "dotenv";

// Load the repo-root .env (apps/api/../../.env), then any local override.
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config();

const [{ buildApp }, { configFromEnv }, { getDb }, { kmsProviderFromEnv }, storagePkg, { queueProducerFromEnv }, { generatePdfForSubmission }] =
  await Promise.all([
    import("./app.js"),
    import("./config.js"),
    import("@gr/db"),
    import("@gr/crypto"),
    import("@gr/storage"),
    import("@gr/queue"),
    import("@gr/worker"),
  ]);

const config = configFromEnv();
const db = getDb();
const storageProviderName = process.env.STORAGE_PROVIDER ?? "local";
const [kms, storage] = await Promise.all([
  kmsProviderFromEnv(),
  storagePkg.storageProviderFromEnv(),
]);
const queue = await queueProducerFromEnv(process.env, {
  inProcessHandler: (msg) => generatePdfForSubmission(msg, { db, kms, storage, storageProviderName }),
});

const app = buildApp({ db, kms, storage, storageProviderName, queue, config });

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
