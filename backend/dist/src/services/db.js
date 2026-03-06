import { randomUUID } from "node:crypto";
import { InMemoryPayloadStore } from "./payloadStore.js";
class InMemoryDb {
    submissions = new Map();
    encryptionMetadata = new Map();
    encryptedPdfRecords = new Map();
    submissionVersions = new Map();
    encryptedRecordVersions = new Map();
    audits = [];
    guestTokenJtis = new Map();
    memberships = [];
    /** Payload store: in-memory for dev/tests; replace with SQL implementation for production. */
    payloadStore = new InMemoryPayloadStore();
    createSubmission(input) {
        const now = new Date().toISOString();
        const record = {
            ...input,
            createdAt: now,
            updatedAt: now
        };
        this.submissions.set(record.id, record);
        this.submissionVersions.set(record.id, 1);
        return record;
    }
    updateSubmission(id, updates) {
        const existing = this.submissions.get(id);
        if (!existing)
            return null;
        const updated = {
            ...existing,
            ...updates,
            updatedAt: new Date().toISOString()
        };
        this.submissions.set(id, updated);
        this.bumpSubmissionVersion(id);
        return updated;
    }
    getSubmissionWithVersion(id) {
        const submission = this.getSubmission(id);
        if (!submission)
            return null;
        return { submission, version: this.submissionVersions.get(id) ?? 0 };
    }
    compareAndSwapSubmission(id, expectedVersion, updates) {
        const currentVersion = this.submissionVersions.get(id) ?? 0;
        if (currentVersion !== expectedVersion) {
            return null;
        }
        return this.updateSubmission(id, updates);
    }
    getSubmission(id) {
        return this.submissions.get(id) ?? null;
    }
    setEncryptionMetadata(meta) {
        this.encryptionMetadata.set(meta.submissionId, meta);
    }
    getEncryptionMetadata(submissionId) {
        return this.encryptionMetadata.get(submissionId) ?? null;
    }
    setEncryptedPdfRecord(record) {
        this.encryptedPdfRecords.set(record.submissionId, record);
        const current = this.encryptedRecordVersions.get(record.submissionId) ?? 0;
        this.encryptedRecordVersions.set(record.submissionId, current + 1);
    }
    getEncryptedPdfRecord(submissionId) {
        return this.encryptedPdfRecords.get(submissionId) ?? null;
    }
    getEncryptedPdfRecordWithVersion(submissionId) {
        const record = this.getEncryptedPdfRecord(submissionId);
        if (!record)
            return null;
        return { record, version: this.encryptedRecordVersions.get(submissionId) ?? 0 };
    }
    compareAndSwapEncryptedPdfRecord(submissionId, expectedVersion, updates) {
        const currentVersion = this.encryptedRecordVersions.get(submissionId) ?? 0;
        if (currentVersion !== expectedVersion) {
            return null;
        }
        const existing = this.encryptedPdfRecords.get(submissionId);
        if (!existing)
            return null;
        const updated = { ...existing, ...updates };
        this.encryptedPdfRecords.set(submissionId, updated);
        this.bumpEncryptedRecordVersion(submissionId);
        return updated;
    }
    addAudit(event) {
        const audit = {
            ...event,
            id: randomUUID(),
            createdAt: new Date().toISOString()
        };
        this.audits.push(audit);
        return audit;
    }
    markGuestTokenUsed(entry) {
        this.guestTokenJtis.set(entry.jti, entry);
    }
    getGuestTokenJti(jti) {
        return this.guestTokenJtis.get(jti) ?? null;
    }
    addMembership(membership) {
        this.memberships.push(membership);
    }
    getOwnerIdentity(userId, tenantId) {
        const propertyIds = this.memberships
            .filter((m) => m.userId === userId && m.tenantId === tenantId)
            .map((m) => m.propertyId);
        return { userId, tenantId, propertyIds };
    }
    setStatus(id, status, lastError) {
        return this.updateSubmission(id, { status, lastError: lastError ?? null });
    }
    async insertPayload(tenantId, propertyId, submissionId, record) {
        await this.payloadStore.insertPayload(tenantId, propertyId, submissionId, record);
    }
    async getPayload(tenantId, propertyId, submissionId) {
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
    bumpSubmissionVersion(id) {
        const current = this.submissionVersions.get(id) ?? 0;
        this.submissionVersions.set(id, current + 1);
    }
    bumpEncryptedRecordVersion(id) {
        const current = this.encryptedRecordVersions.get(id) ?? 0;
        this.encryptedRecordVersions.set(id, current + 1);
    }
}
export const db = new InMemoryDb();
