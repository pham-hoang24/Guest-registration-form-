import type { EncryptedPayloadRecord } from "./payloadEncryption.js";

export type { EncryptedPayloadRecord } from "./payloadEncryption.js";

export interface PayloadStore {
  insertPayload(
    tenantId: string,
    propertyId: string,
    submissionId: string,
    record: EncryptedPayloadRecord
  ): Promise<void>;

  getPayload(
    tenantId: string,
    propertyId: string,
    submissionId: string
  ): Promise<EncryptedPayloadRecord | null>;
}

const key = (tenantId: string, propertyId: string, submissionId: string) =>
  `${tenantId}:${propertyId}:${submissionId}`;

/**
 * In-memory payload store. Used for tests and local dev when SQL is not configured.
 * Production should use a SQL-backed implementation (same interface).
 */
export class InMemoryPayloadStore implements PayloadStore {
  private store = new Map<string, EncryptedPayloadRecord>();

  async insertPayload(
    tenantId: string,
    propertyId: string,
    submissionId: string,
    record: EncryptedPayloadRecord
  ): Promise<void> {
    this.store.set(key(tenantId, propertyId, submissionId), { ...record });
  }

  async getPayload(
    tenantId: string,
    propertyId: string,
    submissionId: string
  ): Promise<EncryptedPayloadRecord | null> {
    return this.store.get(key(tenantId, propertyId, submissionId)) ?? null;
  }

  reset(): void {
    this.store.clear();
  }
}
