import { randomUUID } from "node:crypto";
import type { AuditLog, EncryptionMetadata, OwnerIdentity, SubmissionRecord, SubmissionStatus } from "../types.js";

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
  audits: AuditLog[] = [];
  guestTokenJtis = new Map<string, GuestTokenJti>();
  memberships: PropertyMembership[] = [];

  createSubmission(input: Omit<SubmissionRecord, "createdAt" | "updatedAt">) {
    const now = new Date().toISOString();
    const record: SubmissionRecord = {
      ...input,
      createdAt: now,
      updatedAt: now
    };
    this.submissions.set(record.id, record);
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
    return updated;
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
}

export const db = new InMemoryDb();
