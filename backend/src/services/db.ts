import { randomUUID } from "node:crypto";
import type { AuditLog, EncryptionMetadata, OwnerIdentity, SubmissionRecord, SubmissionStatus } from "../types.js";
import type { EncryptedPdfRecord } from "../storage/encryptedPdfRecord.js";
import type { EncryptedPayloadRecord } from "./payloadEncryption.js";
import type { PayloadStore } from "./payloadStore.js";
import { InMemoryPayloadStore } from "./payloadStore.js";

type GuestTokenJti = {
  jti: string;
  tenantId: string;
  propertyId: string;
  usedAt: string;
  expiresAt: string;
};

type PropertyMembership = {
  userId: string;
  propertyId: string;
  tenantId: string;
};

class InMemoryDb {
  submissions = new Map<string, SubmissionRecord>();
  encryptionMetadata = new Map<string, EncryptionMetadata>();
  encryptedPdfRecords = new Map<string, EncryptedPdfRecord>();
  submissionVersions = new Map<string, number>();
  encryptedRecordVersions = new Map<string, number>();
  audits: AuditLog[] = [];
  guestTokenJtis = new Map<string, GuestTokenJti>();
  memberships: PropertyMembership[] = [];

  /** Payload store: in-memory for dev/tests; replace with SQL implementation for production. */
  payloadStore: PayloadStore = new InMemoryPayloadStore();

  createSubmission(input: Omit<SubmissionRecord, "createdAt" | "updatedAt">) {
    const now = new Date().toISOString();
    const record: SubmissionRecord = {
      ...input,
      createdAt: now,
      updatedAt: now
    };
    this.submissions.set(record.id, record);
    this.submissionVersions.set(record.id, 1);
    return record;
  }

  updateSubmission(id: string, updates: Partial<SubmissionRecord>) {
    const existing = this.submissions.get(id);
    if (!existing) return null;
    const updated: SubmissionRecord = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    this.submissions.set(id, updated);
    this.bumpSubmissionVersion(id);
    return updated;
  }

  getSubmissionWithVersion(id: string) {
    const submission = this.getSubmission(id);
    if (!submission) return null;
    return { submission, version: this.submissionVersions.get(id) ?? 0 };
  }

  compareAndSwapSubmission(id: string, expectedVersion: number, updates: Partial<SubmissionRecord>) {
    const currentVersion = this.submissionVersions.get(id) ?? 0;
    if (currentVersion !== expectedVersion) {
      return null;
    }
    return this.updateSubmission(id, updates);
  }

  getSubmission(id: string) {
    return this.submissions.get(id) ?? null;
  }

  setEncryptionMetadata(meta: EncryptionMetadata) {
    this.encryptionMetadata.set(meta.submissionId, meta);
  }

  getEncryptionMetadata(submissionId: string) {
    return this.encryptionMetadata.get(submissionId) ?? null;
  }

  setEncryptedPdfRecord(record: EncryptedPdfRecord) {
    this.encryptedPdfRecords.set(record.submissionId, record);
    const current = this.encryptedRecordVersions.get(record.submissionId) ?? 0;
    this.encryptedRecordVersions.set(record.submissionId, current + 1);
  }

  getEncryptedPdfRecord(submissionId: string) {
    return this.encryptedPdfRecords.get(submissionId) ?? null;
  }

  getEncryptedPdfRecordWithVersion(submissionId: string) {
    const record = this.getEncryptedPdfRecord(submissionId);
    if (!record) return null;
    return { record, version: this.encryptedRecordVersions.get(submissionId) ?? 0 };
  }

  compareAndSwapEncryptedPdfRecord(
    submissionId: string,
    expectedVersion: number,
    updates: Partial<EncryptedPdfRecord>
  ) {
    const currentVersion = this.encryptedRecordVersions.get(submissionId) ?? 0;
    if (currentVersion !== expectedVersion) {
      return null;
    }
    const existing = this.encryptedPdfRecords.get(submissionId);
    if (!existing) return null;
    const updated = { ...existing, ...updates } as EncryptedPdfRecord;
    this.encryptedPdfRecords.set(submissionId, updated);
    this.bumpEncryptedRecordVersion(submissionId);
    return updated;
  }

  addAudit(event: Omit<AuditLog, "id" | "createdAt">) {
    const audit: AuditLog = {
      ...event,
      id: randomUUID(),
      createdAt: new Date().toISOString()
    };
    this.audits.push(audit);
    return audit;
  }

  markGuestTokenUsed(entry: GuestTokenJti) {
    this.guestTokenJtis.set(entry.jti, entry);
  }

  getGuestTokenJti(jti: string) {
    return this.guestTokenJtis.get(jti) ?? null;
  }

  addMembership(membership: PropertyMembership) {
    this.memberships.push(membership);
  }

  getOwnerIdentity(userId: string, tenantId: string): OwnerIdentity {
    const propertyIds = this.memberships
      .filter((m) => m.userId === userId && m.tenantId === tenantId)
      .map((m) => m.propertyId);
    return { userId, tenantId, propertyIds };
  }

  setStatus(id: string, status: SubmissionStatus, lastError?: string | null) {
    return this.updateSubmission(id, { status, lastError: lastError ?? null });
  }

  async insertPayload(
    tenantId: string,
    propertyId: string,
    submissionId: string,
    record: EncryptedPayloadRecord
  ): Promise<void> {
    await this.payloadStore.insertPayload(tenantId, propertyId, submissionId, record);
  }

  async getPayload(
    tenantId: string,
    propertyId: string,
    submissionId: string
  ): Promise<EncryptedPayloadRecord | null> {
    return this.payloadStore.getPayload(tenantId, propertyId, submissionId);
  }

  reset() {
    this.submissions.clear();
    this.encryptionMetadata.clear();
    this.encryptedPdfRecords.clear();
    this.submissionVersions.clear();
    this.encryptedRecordVersions.clear();
    this.audits = [];
    this.guestTokenJtis.clear();
    this.memberships = [];
    if (this.payloadStore instanceof InMemoryPayloadStore) {
      this.payloadStore.reset();
    }
  }

  private bumpSubmissionVersion(id: string) {
    const current = this.submissionVersions.get(id) ?? 0;
    this.submissionVersions.set(id, current + 1);
  }

  private bumpEncryptedRecordVersion(id: string) {
    const current = this.encryptedRecordVersions.get(id) ?? 0;
    this.encryptedRecordVersions.set(id, current + 1);
  }
}

export const db = new InMemoryDb();
