import { randomUUID } from "node:crypto";
import type { AuditEventType } from "../types.js";
import { db } from "./db.js";

export type AuditContext = {
  correlationId?: string;
  actorType: "guest" | "owner" | "system";
  actorId: string;
  tenantId?: string;
  propertyId?: string;
  submissionId?: string;
  ip?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
};

export const writeAudit = (eventType: AuditEventType, context: AuditContext) => {
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
