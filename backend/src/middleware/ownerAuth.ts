import express from "express";
import jwt from "jsonwebtoken";
import type { OwnerIdentity } from "../types.js";

const ownerJwtSecret = process.env.OWNER_JWT_SECRET || "dev-owner-secret";

/**
 * Extracts and verifies owner identity from Authorization: Bearer <token>.
 * Returns null if header is missing or JWT is invalid.
 */
export function getOwnerFromRequest(req: express.Request): OwnerIdentity | null {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, ownerJwtSecret) as jwt.JwtPayload;
    return {
      userId: String(decoded.sub),
      tenantId: String(decoded.tenantId),
      propertyIds: Array.isArray(decoded.propertyIds) ? decoded.propertyIds.map(String) : []
    };
  } catch {
    return null;
  }
}
