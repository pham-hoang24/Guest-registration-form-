import type { NextFunction, Request, RequestHandler, Response } from "express";
import { writeAudit } from "@gr/db";
import type { OwnerRoleName } from "@gr/shared";
import type { AppDeps } from "../deps.js";
import { sendError } from "../lib/httpErrors.js";
import { auditMetaFromRequest } from "../lib/requestMeta.js";

/** Must run after requireOwnerAuth. Denies with 403 (never 404) on role mismatch. */
export function requireRole(deps: AppDeps, ...roles: readonly OwnerRoleName[]): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      sendError(res, 401, "unauthorized");
      return;
    }
    if (!roles.includes(req.auth.role)) {
      try {
        await writeAudit(deps.db, {
          action: "UNAUTHORIZED_ACCESS_ATTEMPT",
          actorType: "OWNER",
          actorId: req.auth.userId,
          tenantId: req.auth.tenantId,
          resourceType: "OwnerRoute",
          // ponytail: owner API rate limit bounds spam; per-actor/path dedupe is a later item.
          metadata: { ...req.params, requiredRoles: roles.join(","), path: req.path, method: req.method },
          ...auditMetaFromRequest(req),
        });
      } catch {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "audit_write_failed",
            action: "UNAUTHORIZED_ACCESS_ATTEMPT",
          }),
        );
      }
      sendError(res, 403, "forbidden");
      return;
    }
    next();
  };
}
