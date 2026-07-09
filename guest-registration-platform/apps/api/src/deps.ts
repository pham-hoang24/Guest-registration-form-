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
  /** Redis-backed store for the registration-link create/replace limiter, when REDIS_URL is configured. */
  activeLinkRateLimitStore?: Store;
  /** Redis-backed stores for the public registration-link rate limiters, when REDIS_URL is configured. */
  publicRateLimitStores?: {
    get?: Store;
    postMinute?: Store;
    postHourly?: Store;
  };
};
