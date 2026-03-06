import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { OwnerIdentity } from "../types.js";

const ownerJwtSecret = process.env.OWNER_JWT_SECRET || "dev-owner-secret";

const JWT_OPTIONS: jwt.VerifyOptions = { algorithms: ["HS256"] };

function parseOwnerFromPayload(decoded: jwt.JwtPayload): OwnerIdentity {
  return {
    userId: String(decoded.sub ?? ""),
    tenantId: String(decoded.tenantId ?? ""),
    propertyIds: Array.isArray(decoded.propertyIds) ? decoded.propertyIds.map(String) : []
  };
}

/**
 * Middleware: requires Authorization: Bearer <token>, verifies JWT with OWNER_JWT_SECRET (HS256),
 * attaches req.owner = { userId, tenantId, propertyIds }. On missing or invalid token returns 401.
 */
export function requireOwnerAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, ownerJwtSecret, JWT_OPTIONS) as jwt.JwtPayload;
    req.owner = parseOwnerFromPayload(decoded);
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
}

/**
 * Extracts and verifies owner identity from Authorization: Bearer <token>.
 * Returns null if header is missing or JWT is invalid.
 * Prefer using requireOwnerAuth middleware and req.owner in route handlers.
 */
export function getOwnerFromRequest(req: Request): OwnerIdentity | null {
  return req.owner ?? null;
}
