import { db } from "./db.js";

export const canReadSubmission = (userId: string, tenantId: string, submissionId: string) => {
  const submission = db.getSubmission(submissionId);
  if (!submission) return { allowed: false, reason: "not_found" };
  if (submission.tenantId !== tenantId) return { allowed: false, reason: "tenant_mismatch" };

  const identity = db.getOwnerIdentity(userId, tenantId);
  const allowed = identity.propertyIds.includes(submission.propertyId);

  return { allowed, reason: allowed ? "ok" : "property_denied", submission };
};
