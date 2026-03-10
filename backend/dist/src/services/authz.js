import { db } from "./db.js";
export const canReadSubmission = async (userId, tenantId, submissionId) => {
    const submission = await db.getSubmission(submissionId);
    if (!submission)
        return { allowed: false, reason: "not_found" };
    if (submission.tenantId !== tenantId)
        return { allowed: false, reason: "tenant_mismatch" };
    const identity = await db.getOwnerIdentity(userId, tenantId);
    const allowed = identity.propertyIds.includes(submission.propertyId);
    return { allowed, reason: allowed ? "ok" : "property_denied", submission };
};
