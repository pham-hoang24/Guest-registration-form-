import type { ActorType, AuditAction, PrismaClient } from "@prisma/client";

export type AuditEntry = {
  tenantId?: string | null;
  actorType: ActorType;
  actorId?: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  /** Must already be a hash — never pass a raw IP. */
  ipHash?: string | null;
  /** Must already be a hash — never pass a raw user agent. */
  userAgentHash?: string | null;
  /** Must not contain PII (names, emails, document numbers, addresses). */
  metadata?: Record<string, string | number | boolean | readonly string[]> | null;
};

/**
 * Single write path for the audit trail. Callers are responsible for the
 * no-PII rule on metadata; helpers in the API hash IP/user-agent before
 * they reach this function.
 */
export async function writeAudit(db: PrismaClient, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      tenantId: entry.tenantId ?? null,
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      ipHash: entry.ipHash ?? null,
      userAgentHash: entry.userAgentHash ?? null,
      metadataJson: entry.metadata ? JSON.stringify(entry.metadata) : null,
    },
  });
}
