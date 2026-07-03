import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { OwnerRoleName } from "@gr/shared";
import { sendError } from "../lib/httpErrors.js";

/** Must run after requireOwnerAuth. Denies with 403 (never 404) on role mismatch. */
export function requireRole(...roles: readonly OwnerRoleName[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      sendError(res, 401, "unauthorized");
      return;
    }
    if (!roles.includes(req.auth.role)) {
      sendError(res, 403, "forbidden");
      return;
    }
    next();
  };
}
