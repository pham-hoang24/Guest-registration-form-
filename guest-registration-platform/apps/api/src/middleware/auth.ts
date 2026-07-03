import type { NextFunction, Request, RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import type { OwnerRoleName } from "@gr/shared";
import type { AppDeps } from "../deps.js";
import { sendError } from "../lib/httpErrors.js";

export type OwnerAuthContext = {
  userId: string;
  tenantId: string;
  role: OwnerRoleName;
  email: string;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: OwnerAuthContext;
    }
  }
}

type OwnerTokenClaims = {
  sub: string;
  tenantId: string;
  role: OwnerRoleName;
};

export function signOwnerToken(deps: AppDeps, user: OwnerTokenClaims): string {
  return jwt.sign({ tenantId: user.tenantId, role: user.role }, deps.config.jwtSecret, {
    subject: user.sub,
    issuer: deps.config.jwtIssuer,
    audience: deps.config.jwtAudience,
    expiresIn: deps.config.jwtExpiresIn as jwt.SignOptions["expiresIn"],
    algorithm: "HS256",
  });
}

/**
 * Verifies the bearer token, then re-checks the user in the database so
 * disabled users and suspended tenants are locked out immediately even with
 * a still-valid JWT.
 */
export function requireOwnerAuth(deps: AppDeps): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization;
      if (!header?.startsWith("Bearer ")) {
        sendError(res, 401, "unauthorized");
        return;
      }
      const token = header.slice("Bearer ".length);

      let claims: OwnerTokenClaims & jwt.JwtPayload;
      try {
        claims = jwt.verify(token, deps.config.jwtSecret, {
          issuer: deps.config.jwtIssuer,
          audience: deps.config.jwtAudience,
          algorithms: ["HS256"],
        }) as OwnerTokenClaims & jwt.JwtPayload;
      } catch {
        sendError(res, 401, "unauthorized");
        return;
      }

      const user = await deps.db.ownerUser.findFirst({
        where: { id: claims.sub, tenantId: claims.tenantId, status: "ACTIVE" },
        include: { tenant: { select: { status: true } } },
      });
      if (!user || user.tenant.status !== "ACTIVE") {
        sendError(res, 401, "unauthorized");
        return;
      }

      req.auth = {
        userId: user.id,
        tenantId: user.tenantId,
        role: user.role,
        email: user.email,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}
