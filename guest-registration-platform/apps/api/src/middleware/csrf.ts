import { createHmac, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import type { AppDeps } from "../deps.js";
import { getCookie } from "./auth.js";
import { sendError } from "../lib/httpErrors.js";

/**
 * CSRF protection for owner state-changing requests.
 *
 * The owner session lives in an httpOnly, SameSite=Strict cookie (already strong
 * against CSRF); this is defense in depth via a signed double-submit token. The
 * token is a deterministic HMAC of the session cookie value, so it is verifiable
 * statelessly and is only obtainable by a client that can read the authenticated
 * `/me` (or login) response — which a cross-origin attacker cannot, thanks to
 * CORS with credentials. The raw token is never stored in localStorage: the SPA
 * holds it in memory and echoes it in the `X-CSRF-Token` header.
 */

const CSRF_HEADER = "x-csrf-token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Deterministic CSRF token bound to a session cookie value (domain-separated HMAC). */
export function csrfTokenForSession(deps: AppDeps, sessionToken: string): string {
  return createHmac("sha256", deps.config.jwtSecret)
    .update(`owner-csrf:${sessionToken}`)
    .digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Rejects an owner mutation (non-safe method) that lacks a valid `X-CSRF-Token`
 * header for its session cookie. Requests with no session cookie (bearer-token or
 * unauthenticated) are not cookie-CSRF-exploitable and pass through untouched;
 * `requireOwnerAuth` remains responsible for authenticating them.
 */
export function requireCsrf(deps: AppDeps): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const sessionToken = getCookie(req, deps.config.ownerAuthCookieName);
    if (!sessionToken) {
      next();
      return;
    }
    const provided = req.get(CSRF_HEADER);
    if (!provided || !safeEqual(provided, csrfTokenForSession(deps, sessionToken))) {
      sendError(res, 403, "csrf_failed");
      return;
    }
    next();
  };
}
