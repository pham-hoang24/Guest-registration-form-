import { Router } from "express";
import bcrypt from "bcryptjs";
import { writeAudit } from "@gr/db";
import { ownerLoginRequestSchema } from "@gr/shared";
import type { AppDeps } from "../deps.js";
import { sendError } from "../lib/httpErrors.js";
import { auditMetaFromRequest } from "../lib/requestMeta.js";
import { requireOwnerAuth, signOwnerToken } from "../middleware/auth.js";
import { loginRateLimit } from "../middleware/rateLimit.js";

/** Parses "4h" / "30m" / "1d" / "90s" — the small set of formats this config value uses. */
function expiresInToMs(expiresIn: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(expiresIn);
  if (!match) throw new Error(`Unsupported jwtExpiresIn format: ${expiresIn}`);
  const value = Number(match[1]);
  const unitMs = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as string]!;
  return value * unitMs;
}

function setSessionCookie(res: import("express").Response, deps: AppDeps, token: string): void {
  res.cookie(deps.config.ownerAuthCookieName, token, {
    httpOnly: true,
    secure: deps.config.ownerCookieSecure,
    sameSite: "strict",
    path: "/",
    maxAge: expiresInToMs(deps.config.jwtExpiresIn),
  });
}

export function ownerAuthRoutes(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;

  router.post("/login", loginRateLimit(deps.config), async (req, res, next) => {
    try {
      const parsed = ownerLoginRequestSchema.safeParse(req.body);
      // The same generic response for every failure mode — never reveal
      // whether the email exists or which check failed.
      const deny = async (actorId: string | null, tenantId: string | null) => {
        await writeAudit(db, {
          tenantId,
          actorType: "OWNER",
          actorId,
          action: "OWNER_LOGIN_FAILED",
          resourceType: "OwnerUser",
          resourceId: actorId,
          ...auditMetaFromRequest(req),
        });
        sendError(res, 401, "invalid_credentials");
      };

      if (!parsed.success) {
        await deny(null, null);
        return;
      }

      const user = await db.ownerUser.findUnique({
        where: { email: parsed.data.email.toLowerCase() },
        include: { tenant: { select: { status: true } } },
      });

      if (!user) {
        // Constant-work path: hash anyway so response timing does not reveal
        // whether the account exists.
        await bcrypt.compare(parsed.data.password, "$2a$12$C6UzMDM.H6dfI/f/IKcEeO7ccuNDQYqm9y1b2rrqzzIRlPYRXhcVm");
        await deny(null, null);
        return;
      }

      const passwordOk = await bcrypt.compare(parsed.data.password, user.passwordHash);
      if (!passwordOk || user.status !== "ACTIVE" || user.tenant.status !== "ACTIVE") {
        await deny(user.id, user.tenantId);
        return;
      }

      const token = signOwnerToken(deps, {
        sub: user.id,
        tenantId: user.tenantId,
        role: user.role,
      });

      await writeAudit(db, {
        tenantId: user.tenantId,
        actorType: "OWNER",
        actorId: user.id,
        action: "OWNER_LOGIN_SUCCEEDED",
        resourceType: "OwnerUser",
        resourceId: user.id,
        ...auditMetaFromRequest(req),
      });

      setSessionCookie(res, deps, token);
      res.setHeader("cache-control", "no-store");
      res.json({
        user: { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", (_req, res) => {
    res.clearCookie(deps.config.ownerAuthCookieName, {
      path: "/",
      sameSite: "strict",
      secure: deps.config.ownerCookieSecure,
    });
    res.setHeader("cache-control", "no-store");
    res.status(204).end();
  });

  router.get("/me", requireOwnerAuth(deps), (req, res) => {
    const auth = req.auth!;
    res.json({
      id: auth.userId,
      email: auth.email,
      role: auth.role,
      tenantId: auth.tenantId,
    });
  });

  return router;
}
