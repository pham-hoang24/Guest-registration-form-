import { randomUUID } from "node:crypto";
import type { AuditLog, OwnerIdentity, SubmissionRecord, SubmissionStatus } from "../types.js";
import type { EncryptedPdfRecord } from "../storage/encryptedPdfRecord.js";
import type { EncryptedPayloadRecord } from "./payloadEncryption.js";
import { InMemoryPayloadStore } from "./payloadStore.js";
import type { DbAdapter, GuestTokenJti, PropertyMembership } from "./dbInterface.js";

export class InMemoryDb implements DbAdapter {
  submissions = new Map<string, SubmissionRecord>();
  encryptedPdfRecords = new Map<string, EncryptedPdfRecord>();
  submissionVersions = new Map<string, number>();
  encryptedRecordVersions = new Map<string, number>();
  audits: AuditLog[] = [];
  guestTokenJtis = new Map<string, GuestTokenJti>();
  memberships: PropertyMembership[] = [];
  private payloadStore = new InMemoryPayloadStore();

  async createSubmission(input: Omit<SubmissionRecord, "createdAt" | "updatedAt">): Promise<SubmissionRecord> {
    const now = new Date().toISOString();
    const record: SubmissionRecord = { ...input, createdAt: now, updatedAt: now };
    this.submissions.set(record.id, record);
    this.submissionVersions.set(record.id, 1);
    return record;
  }

  async updateSubmission(id: string, updates: Partial<SubmissionRecord>): Promise<SubmissionRecord | null> {
    const existing = this.submissions.get(id);
    if (!existing) return null;
    const updated: SubmissionRecord = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.submissions.set(id, updated);
    this.bumpSubmissionVersion(id);
    return updated;
  }

  async getSubmission(id: string): Promise<SubmissionRecord | null> {
    return this.submissions.get(id) ?? null;
  }

  async getSubmissionWithVersion(id: string): Promise<{ submission: SubmissionRecord; version: number } | null> {
    const submission = await this.getSubmission(id);
    if (!submission) return null;
    return { submission, version: this.submissionVersions.get(id) ?? 0 };
  }

  async compareAndSwapSubmission(
    id: string,
    expectedVersion: number,
    updates: Partial<SubmissionRecord>
  ): Promise<SubmissionRecord | null> {
    const currentVersion = this.submissionVersions.get(id) ?? 0;
    if (currentVersion !== expectedVersion) return null;
    return this.updateSubmission(id, updates);
  }

  async setStatus(id: string, status: SubmissionStatus, lastError?: string | null): Promise<SubmissionRecord | null> {
    return this.updateSubmission(id, { status, lastError: lastError ?? null });
  }

  async setEncryptedPdfRecord(record: EncryptedPdfRecord): Promise<void> {
    this.encryptedPdfRecords.set(record.submissionId, record);
    const current = this.encryptedRecordVersions.get(record.submissionId) ?? 0;
    this.encryptedRecordVersions.set(record.submissionId, current + 1);
  }

  async getEncryptedPdfRecord(submissionId: string): Promise<EncryptedPdfRecord | null> {
    return this.encryptedPdfRecords.get(submissionId) ?? null;
  }

  async getEncryptedPdfRecordWithVersion(
    submissionId: string
  ): Promise<{ record: EncryptedPdfRecord; version: number } | null> {
    const record = await this.getEncryptedPdfRecord(submissionId);
    if (!record) return null;
    return { record, version: this.encryptedRecordVersions.get(submissionId) ?? 0 };
  }

  async compareAndSwapEncryptedPdfRecord(
    submissionId: string,
    expectedVersion: number,
    updates: Partial<EncryptedPdfRecord>
  ): Promise<EncryptedPdfRecord | null> {
    const currentVersion = this.encryptedRecordVersions.get(submissionId) ?? 0;
    if (currentVersion !== expectedVersion) return null;
    const existing = this.encryptedPdfRecords.get(submissionId);
    if (!existing) return null;
    const updated = { ...existing, ...updates } as EncryptedPdfRecord;
    this.encryptedPdfRecords.set(submissionId, updated);
    this.bumpEncryptedRecordVersion(submissionId);
    return updated;
  }

  async getEncryptedPdfRecordsByKek(
    kekKeyId: string,
    kekKeyVersion: string | undefined,
    page: { offset: number; limit: number }
  ): Promise<Array<{ record: EncryptedPdfRecord; version: number }>> {
    const all = [...this.encryptedPdfRecords.values()]
      .filter(
        (r) =>
          r.kekKeyId === kekKeyId &&
          (kekKeyVersion === undefined || r.kekKeyVersion === kekKeyVersion)
      )
      .sort((a, b) => a.submissionId.localeCompare(b.submissionId))
      .slice(page.offset, page.offset + page.limit);
    return all.map((record) => ({
      record,
      version: this.encryptedRecordVersions.get(record.submissionId) ?? 0
    }));
  }

  async addAudit(event: Omit<AuditLog, "id" | "createdAt">): Promise<AuditLog> {
    const audit: AuditLog = { ...event, id: randomUUID(), createdAt: new Date().toISOString() };
    this.audits.push(audit);
    return audit;
  }

  async markGuestTokenUsed(entry: GuestTokenJti): Promise<void> {
    this.guestTokenJtis.set(entry.jti, entry);
  }

  async getGuestTokenJti(jti: string): Promise<GuestTokenJti | null> {
    return this.guestTokenJtis.get(jti) ?? null;
  }

  async addMembership(membership: PropertyMembership): Promise<void> {
    this.memberships.push(membership);
  }

  async getOwnerIdentity(userId: string, tenantId: string): Promise<OwnerIdentity> {
    const propertyIds = this.memberships
      .filter((m) => m.userId === userId && m.tenantId === tenantId)
      .map((m) => m.propertyId);
    return { userId, tenantId, propertyIds };
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

  reset(): void {
    this.submissions.clear();
    this.encryptedPdfRecords.clear();
    this.submissionVersions.clear();
    this.encryptedRecordVersions.clear();
    this.audits = [];
    this.guestTokenJtis.clear();
    this.memberships = [];
    this.payloadStore.reset();
  }

  private bumpSubmissionVersion(id: string): void {
    const current = this.submissionVersions.get(id) ?? 0;
    this.submissionVersions.set(id, current + 1);
  }

  private bumpEncryptedRecordVersion(id: string): void {
    const current = this.encryptedRecordVersions.get(id) ?? 0;
    this.encryptedRecordVersions.set(id, current + 1);
  }
}
