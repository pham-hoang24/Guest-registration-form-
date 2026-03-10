import { describe, expect, it, beforeEach } from "vitest";
import { db } from "../src/services/db.js";
import { canReadSubmission } from "../src/services/authz.js";
describe("authz", () => {
    beforeEach(() => {
        db.reset();
    });
    it("denies owner without property membership", async () => {
        await db.createSubmission({
            id: "sub1",
            tenantId: "tenant1",
            propertyId: "property1",
            reservationId: null,
            status: "READY",
            blobPath: "blob",
            aadVersion: 1,
            schemaVersion: 1,
            attemptCount: 0,
            lastError: null
        });
        const result = await canReadSubmission("user1", "tenant1", "sub1");
        expect(result.allowed).toBe(false);
    });
    it("allows owner with property membership", async () => {
        await db.createSubmission({
            id: "sub2",
            tenantId: "tenant1",
            propertyId: "property1",
            reservationId: null,
            status: "READY",
            blobPath: "blob",
            aadVersion: 1,
            schemaVersion: 1,
            attemptCount: 0,
            lastError: null
        });
        await db.addMembership({ userId: "user1", tenantId: "tenant1", propertyId: "property1" });
        const result = await canReadSubmission("user1", "tenant1", "sub2");
        expect(result.allowed).toBe(true);
    });
});
