import type { AuditLog, OwnerIdentity, SubmissionRecord, SubmissionStatus } from "../types.js";
import type { EncryptedPdfRecord } from "../storage/encryptedPdfRecord.js";
import type { EncryptedPayloadRecord } from "./payloadEncryption.js";

export type GuestTokenJti = {
  jti: string;
  tenantId: string;
  propertyId: string;
  usedAt: string;
  expiresAt: string;
};

export type PropertyMembership = {
  userId: string;
  propertyId: string;
  tenantId: string;
};

export interface DbAdapter {
  createSubmission(input: Omit<SubmissionRecord, "createdAt" | "updatedAt">): Promise<SubmissionRecord>;
  updateSubmission(id: string, updates: Partial<SubmissionRecord>): Promise<SubmissionRecord | null>;
  getSubmission(id: string): Promise<SubmissionRecord | null>;
  getSubmissionWithVersion(id: string): Promise<{ submission: SubmissionRecord; version: number } | null>;
  compareAndSwapSubmission(id: string, expectedVersion: number, updates: Partial<SubmissionRecord>): Promise<SubmissionRecord | null>;
  setStatus(id: string, status: SubmissionStatus, lastError?: string | null): Promise<SubmissionRecord | null>;

  setEncryptedPdfRecord(record: EncryptedPdfRecord): Promise<void>;
  getEncryptedPdfRecord(submissionId: string): Promise<EncryptedPdfRecord | null>;
  getEncryptedPdfRecordWithVersion(submissionId: string): Promise<{ record: EncryptedPdfRecord; version: number } | null>;
  compareAndSwapEncryptedPdfRecord(submissionId: string, expectedVersion: number, updates: Partial<EncryptedPdfRecord>): Promise<EncryptedPdfRecord | null>;
  /**
   * Paginated query by KEK key ID/version. Used by the rewrap job.
   * NOTE: This method operates without tenant context and returns records across all tenants.
   * It must be called only from privileged system processes (rewrap job), never from
   * tenant-scoped request handlers.
   */
  getEncryptedPdfRecordsByKek(
    kekKeyId: string,
    kekKeyVersion: string | undefined,
    page: { offset: number; limit: number }
  ): Promise<Array<{ record: EncryptedPdfRecord; version: number }>>;

  addAudit(event: Omit<AuditLog, "id" | "createdAt">): Promise<AuditLog>;

  markGuestTokenUsed(entry: GuestTokenJti): Promise<void>;
  getGuestTokenJti(jti: string): Promise<GuestTokenJti | null>;

  getOwnerIdentity(userId: string, tenantId: string): Promise<OwnerIdentity>;
  addMembership(membership: PropertyMembership): Promise<void>;

  insertPayload(tenantId: string, propertyId: string, submissionId: string, record: EncryptedPayloadRecord): Promise<void>;
  getPayload(tenantId: string, propertyId: string, submissionId: string): Promise<EncryptedPayloadRecord | null>;
}
