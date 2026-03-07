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

/**
 * Write an audit event. Returns void and never throws — errors are logged to
 * stderr so that audit failures never block or fail the calling operation.
 *
 * This is intentionally fire-and-forget: critical-path code (registration,
 * download, worker) must not fail because of an audit log outage.
 * If an audit insert fails, the error is emitted to stderr where it can be
 * captured by the host log sink (e.g. Azure Monitor).
 */
export const writeAudit = (eventType: AuditEventType, context: AuditContext): void => {
  const correlationId = context.correlationId ?? randomUUID();
  db
    .addAudit({
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
    })
    .catch((err) => {
      console.error(
        "[audit] Failed to persist audit event:",
        eventType,
        correlationId,
        err instanceof Error ? err.message : err
      );
    });
};
