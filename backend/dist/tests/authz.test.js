import { describe, expect, it, beforeEach } from "vitest";
import { db } from "../src/services/db.js";
import { canReadSubmission } from "../src/services/authz.js";
describe("authz", () => {
    beforeEach(() => {
        db.submissions.clear();
        db.memberships = [];
    });
    it("denies owner without property membership", () => {
        db.createSubmission({
            id: "sub1",
            tenantId: "tenant1",
            propertyId: "property1",
            reservationId: null,
            status: "READY",
            blobPath: "blob",
            wrappedDek: "wrapped",
            kekKeyId: "key",
            kekKeyVersion: "v1",
            contentHash: "hash",
            aadVersion: 1,
            schemaVersion: 1,
            attemptCount: 0,
            lastError: null
        });
        const result = canReadSubmission("user1", "tenant1", "sub1");
        expect(result.allowed).toBe(false);
    });
    it("allows owner with property membership", () => {
        db.createSubmission({
            id: "sub2",
            tenantId: "tenant1",
            propertyId: "property1",
            reservationId: null,
            status: "READY",
            blobPath: "blob",
            wrappedDek: "wrapped",
            kekKeyId: "key",
            kekKeyVersion: "v1",
            contentHash: "hash",
            aadVersion: 1,
            schemaVersion: 1,
            attemptCount: 0,
            lastError: null
        });
        db.addMembership({ userId: "user1", tenantId: "tenant1", propertyId: "property1" });
        const result = canReadSubmission("user1", "tenant1", "sub2");
        expect(result.allowed).toBe(true);
    });
});
