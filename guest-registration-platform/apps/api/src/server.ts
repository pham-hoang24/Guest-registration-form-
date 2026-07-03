import path from "node:path";
import dotenv from "dotenv";

// Load the repo-root .env (apps/api/../../.env), then any local override.
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config();

const [{ buildApp }, { configFromEnv }, { getDb }, { kmsProviderFromEnv }, storagePkg] =
  await Promise.all([
    import("./app.js"),
    import("./config.js"),
    import("@gr/db"),
    import("@gr/crypto"),
    import("@gr/storage"),
  ]);

const config = configFromEnv();
const app = buildApp({
  db: getDb(),
  kms: kmsProviderFromEnv(),
  storage: storagePkg.storageProviderFromEnv(),
  storageProviderName: process.env.STORAGE_PROVIDER ?? "local",
  config,
});

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
