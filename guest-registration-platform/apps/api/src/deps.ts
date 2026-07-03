import type { PrismaClient } from "@gr/db";
import type { KmsProvider } from "@gr/crypto";
import type { StorageProvider } from "@gr/storage";
import type { ApiConfig } from "./config.js";

export type AppDeps = {
  db: PrismaClient;
  kms: KmsProvider;
  storage: StorageProvider;
  storageProviderName: string;
  config: ApiConfig;
};
