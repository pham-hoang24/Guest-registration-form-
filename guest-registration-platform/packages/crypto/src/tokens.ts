import { createHash, randomBytes } from "node:crypto";

/**
 * Registration link tokens: 32 bytes of entropy, base64url encoded.
 * Only the SHA-256 hex hash is ever stored; the raw token exists in the
 * generated URL only.
 */
export function generateRegistrationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRegistrationToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** One-way hash for IP / user-agent values stored in audit logs (no raw PII). */
export function hashForAudit(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
