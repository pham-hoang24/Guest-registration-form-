import { randomUUID } from "node:crypto";
import { db } from "./db.js";
export const writeAudit = (eventType, context) => {
    const correlationId = context.correlationId ?? randomUUID();
    return db.addAudit({
        eventType,
        correlationId,
        actorType: context.actorType,
        actorId: context.actorId,
        tenantId: context.tenantId ?? null,
        propertyId: context.propertyId ?? null,
        submissionId: context.submissionId ?? null,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
        details: context.details ?? {}
    });
};
