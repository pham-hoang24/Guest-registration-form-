import path from "node:path";
import dotenv from "dotenv";

// Load the repo-root .env (apps/api/../../.env), then any local override.
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config();

const [{ buildApp }, { configFromEnv }, { getDb }, { kmsProviderFromEnv }, storagePkg, { queueProducerFromEnv }, { generatePdfForPassengerCard }, { buildRedisRateLimitStore }] =
  await Promise.all([
    import("./app.js"),
    import("./config.js"),
    import("@gr/db"),
    import("@gr/crypto"),
    import("@gr/storage"),
    import("@gr/queue"),
    import("@gr/worker"),
    import("./middleware/rateLimit.js"),
  ]);

const config = configFromEnv();
const db = getDb();
const storageProviderName = process.env.STORAGE_PROVIDER ?? "local";
const [kms, storage] = await Promise.all([
  kmsProviderFromEnv(),
  storagePkg.storageProviderFromEnv(),
]);
const queue = await queueProducerFromEnv(process.env, {
  inProcessHandler: (msg) => generatePdfForPassengerCard(msg, { db, kms, storage, storageProviderName }),
});

// Verifying the connection here means a misconfigured Redis fails startup
// loudly instead of silently falling back to per-process rate limiting.
const [loginRateLimitStore, publicGetRateLimitStore, publicPostRateLimitStore, publicPostHourlyRateLimitStore] =
  config.redisUrl
    ? await Promise.all([
        buildRedisRateLimitStore(config.redisUrl, "login:"),
        buildRedisRateLimitStore(config.redisUrl, "pub-get:"),
        buildRedisRateLimitStore(config.redisUrl, "pub-post:"),
        buildRedisRateLimitStore(config.redisUrl, "pub-post-hr:"),
      ])
    : [undefined, undefined, undefined, undefined];

const app = buildApp({
  db,
  kms,
  storage,
  storageProviderName,
  queue,
  config,
  loginRateLimitStore,
  publicRateLimitStores: {
    get: publicGetRateLimitStore,
    postMinute: publicPostRateLimitStore,
    postHourly: publicPostHourlyRateLimitStore,
  },
});

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
