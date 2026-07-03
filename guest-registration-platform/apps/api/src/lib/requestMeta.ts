import type { Request } from "express";
import { hashForAudit } from "@gr/crypto";

/**
 * Audit logs never store raw IPs or user agents — only SHA-256 hashes,
 * which still allow correlating repeated activity.
 */
export function auditMetaFromRequest(req: Request): {
  ipHash: string | null;
  userAgentHash: string | null;
} {
  const ip = req.ip;
  const userAgent = req.headers["user-agent"];
  return {
    ipHash: ip ? hashForAudit(ip) : null,
    userAgentHash: typeof userAgent === "string" ? hashForAudit(userAgent) : null,
  };
}
