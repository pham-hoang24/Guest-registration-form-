import type { Store } from "express-rate-limit";
import type { PrismaClient } from "@gr/db";
import type { KmsProvider } from "@gr/crypto";
import type { StorageProvider } from "@gr/storage";
import type { QueueProducer } from "@gr/queue";
import type { ApiConfig } from "./config.js";

export type AppDeps = {
  db: PrismaClient;
  kms: KmsProvider;
  storage: StorageProvider;
  storageProviderName: string;
  queue: QueueProducer;
  config: ApiConfig;
  /** Redis-backed store for the login rate limiter, when REDIS_URL is configured. */
  loginRateLimitStore?: Store;
};
