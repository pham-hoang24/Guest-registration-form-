import type { PrismaClient } from "@gr/db";
import type { KmsProvider } from "@gr/crypto";
import type { StorageProvider } from "@gr/storage";

/**
 * Explicit dependency bundle so jobs are testable and the transport can move
 * from in-process calls to Azure Service Bus without rewriting job logic.
 */
export type WorkerDeps = {
  db: PrismaClient;
  kms: KmsProvider;
  storage: StorageProvider;
  storageProviderName: string;
};
