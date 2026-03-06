const key = (tenantId, propertyId, submissionId) => `${tenantId}:${propertyId}:${submissionId}`;
/**
 * In-memory payload store. Used for tests and local dev when SQL is not configured.
 * Production should use a SQL-backed implementation (same interface).
 */
export class InMemoryPayloadStore {
    store = new Map();
    async insertPayload(tenantId, propertyId, submissionId, record) {
        this.store.set(key(tenantId, propertyId, submissionId), { ...record });
    }
    async getPayload(tenantId, propertyId, submissionId) {
        return this.store.get(key(tenantId, propertyId, submissionId)) ?? null;
    }
    reset() {
        this.store.clear();
    }
}
