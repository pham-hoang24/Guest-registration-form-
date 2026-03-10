import { randomUUID } from "node:crypto";
import { InMemoryPayloadStore } from "./payloadStore.js";
export class InMemoryDb {
    submissions = new Map();
    encryptedPdfRecords = new Map();
    submissionVersions = new Map();
    encryptedRecordVersions = new Map();
    audits = [];
    guestTokenJtis = new Map();
    memberships = [];
    payloadStore = new InMemoryPayloadStore();
    async createSubmission(input) {
        const now = new Date().toISOString();
        const record = { ...input, createdAt: now, updatedAt: now };
        this.submissions.set(record.id, record);
        this.submissionVersions.set(record.id, 1);
        return record;
    }
    async updateSubmission(id, updates) {
        const existing = this.submissions.get(id);
        if (!existing)
            return null;
        const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
        this.submissions.set(id, updated);
        this.bumpSubmissionVersion(id);
        return updated;
    }
    async getSubmission(id) {
        return this.submissions.get(id) ?? null;
    }
    async getSubmissionWithVersion(id) {
        const submission = await this.getSubmission(id);
        if (!submission)
            return null;
        return { submission, version: this.submissionVersions.get(id) ?? 0 };
    }
    async compareAndSwapSubmission(id, expectedVersion, updates) {
        const currentVersion = this.submissionVersions.get(id) ?? 0;
        if (currentVersion !== expectedVersion)
            return null;
        return this.updateSubmission(id, updates);
    }
    async setStatus(id, status, lastError) {
        return this.updateSubmission(id, { status, lastError: lastError ?? null });
    }
    async setEncryptedPdfRecord(record) {
        this.encryptedPdfRecords.set(record.submissionId, record);
        const current = this.encryptedRecordVersions.get(record.submissionId) ?? 0;
        this.encryptedRecordVersions.set(record.submissionId, current + 1);
    }
    async getEncryptedPdfRecord(submissionId) {
        return this.encryptedPdfRecords.get(submissionId) ?? null;
    }
    async getEncryptedPdfRecordWithVersion(submissionId) {
        const record = await this.getEncryptedPdfRecord(submissionId);
        if (!record)
            return null;
        return { record, version: this.encryptedRecordVersions.get(submissionId) ?? 0 };
    }
    async compareAndSwapEncryptedPdfRecord(submissionId, expectedVersion, updates) {
        const currentVersion = this.encryptedRecordVersions.get(submissionId) ?? 0;
        if (currentVersion !== expectedVersion)
            return null;
        const existing = this.encryptedPdfRecords.get(submissionId);
        if (!existing)
            return null;
        const updated = { ...existing, ...updates };
        this.encryptedPdfRecords.set(submissionId, updated);
        this.bumpEncryptedRecordVersion(submissionId);
        return updated;
    }
    async getEncryptedPdfRecordsByKek(kekKeyId, kekKeyVersion, page) {
        const all = [...this.encryptedPdfRecords.values()]
            .filter((r) => r.kekKeyId === kekKeyId &&
            (kekKeyVersion === undefined || r.kekKeyVersion === kekKeyVersion))
            .sort((a, b) => a.submissionId.localeCompare(b.submissionId))
            .slice(page.offset, page.offset + page.limit);
        return all.map((record) => ({
            record,
            version: this.encryptedRecordVersions.get(record.submissionId) ?? 0
        }));
    }
    async addAudit(event) {
        const audit = { ...event, id: randomUUID(), createdAt: new Date().toISOString() };
        this.audits.push(audit);
        return audit;
    }
    async markGuestTokenUsed(entry) {
        this.guestTokenJtis.set(entry.jti, entry);
    }
    async getGuestTokenJti(jti) {
        return this.guestTokenJtis.get(jti) ?? null;
    }
    async addMembership(membership) {
        this.memberships.push(membership);
    }
    async getOwnerIdentity(userId, tenantId) {
        const propertyIds = this.memberships
            .filter((m) => m.userId === userId && m.tenantId === tenantId)
            .map((m) => m.propertyId);
        return { userId, tenantId, propertyIds };
    }
    async insertPayload(tenantId, propertyId, submissionId, record) {
        await this.payloadStore.insertPayload(tenantId, propertyId, submissionId, record);
    }
    async getPayload(tenantId, propertyId, submissionId) {
        return this.payloadStore.getPayload(tenantId, propertyId, submissionId);
    }
    async listSubmissions(propertyId, tenantId, page) {
        const all = [...this.submissions.values()]
            .filter((s) => s.propertyId === propertyId && s.tenantId === tenantId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const total = all.length;
        const submissions = all.slice(page.offset, page.offset + page.limit);
        return { submissions, total };
    }
    reset() {
        this.submissions.clear();
        this.encryptedPdfRecords.clear();
        this.submissionVersions.clear();
        this.encryptedRecordVersions.clear();
        this.audits = [];
        this.guestTokenJtis.clear();
        this.memberships = [];
        this.payloadStore.reset();
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
