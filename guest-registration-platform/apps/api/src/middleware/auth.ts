import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createPublicKey, type JsonWebKey, type KeyObject } from "node:crypto";
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

// ---------------------------------------------------------------------------
// Cookie / bearer token extraction
// ---------------------------------------------------------------------------

export function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${name}=`)) continue;
    const raw = trimmed.slice(name.length + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

function getBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length);
}

// ---------------------------------------------------------------------------
// JWKS key cache (RS256 mode) — ported from the legacy ownerAuth middleware,
// hardened with a fetch timeout, no-redirect, and fail-closed on cache miss.
// ---------------------------------------------------------------------------

type JwksEntry = { kid?: string; key: KeyObject };
type JwksCache = { entries: JwksEntry[]; cachedAt: number };

const JWKS_TTL_MS = 5 * 60_000;
const JWKS_FETCH_TIMEOUT_MS = 3_000;

let jwksCache: JwksCache | null = null;
let inflightFetch: Promise<JwksEntry[]> | null = null;

async function fetchJwksEntries(uri: string): Promise<JwksEntry[]> {
  const res = await fetch(uri, {
    signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS),
    redirect: "error",
  });
  if (!res.ok) throw new Error(`JWKS fetch error: ${res.status}`);

  const body = (await res.json()) as unknown;
  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as Record<string, unknown>).keys)
  ) {
    throw new Error("Invalid JWKS response: missing or non-array 'keys' property");
  }

  const entries: JwksEntry[] = [];
  for (const jwk of (body as { keys: unknown[] }).keys) {
    if (!jwk || typeof jwk !== "object") continue;
    const k = jwk as Record<string, unknown>;
    if (k.kty !== "RSA") continue;
    if (k.use && k.use !== "sig") continue;
    if (k.alg && k.alg !== "RS256") continue;
    try {
      entries.push({
        kid: typeof k.kid === "string" ? k.kid : undefined,
        key: createPublicKey({ key: k as unknown as JsonWebKey, format: "jwk" }),
      });
    } catch {
      // Skip keys that can't be imported (malformed, wrong curve, etc.)
    }
  }

  if (entries.length === 0) {
    throw new Error("JWKS response contained no usable RSA signing keys");
  }
  return entries;
}

async function getJwksKeys(uri: string): Promise<JwksEntry[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.cachedAt < JWKS_TTL_MS) {
    return jwksCache.entries;
  }
  if (inflightFetch) return inflightFetch;
  inflightFetch = fetchJwksEntries(uri)
    .then((entries) => {
      jwksCache = { entries, cachedAt: Date.now() };
      return entries;
    })
    .catch((error) => {
      // Fail closed: if we have no cache at all, propagate. If we have a stale
      // cache (expired by TTL), keep serving it rather than locking everyone out
      // on a transient IdP blip.
      if (jwksCache) return jwksCache.entries;
      throw error;
    })
    .finally(() => {
      inflightFetch = null;
    });
  return inflightFetch;
}

async function verifyRs256(
  token: string,
  jwksUri: string,
  issuer: string,
  audience: string,
): Promise<OwnerTokenClaims & jwt.JwtPayload> {
  const header = jwt.decode(token, { complete: true })?.header;
  const kid = header?.kid as string | undefined;
  const entries = await getJwksKeys(jwksUri);
  const candidates = kid ? entries.filter((e) => e.kid === kid) : entries;
  if (candidates.length === 0) {
    throw new Error("No matching JWKS key found");
  }
  for (const { key } of candidates) {
    try {
      // algorithms is pinned to RS256 regardless of the token header's own `alg`.
      return jwt.verify(token, key, {
        algorithms: ["RS256"],
        issuer,
        audience,
      }) as OwnerTokenClaims & jwt.JwtPayload;
    } catch {
      // try next candidate
    }
  }
  throw new Error("RS256 signature verification failed");
}

/** Exported for tests — clears the JWKS cache so tests can inject fake state. */
export function clearJwksCacheForTests(): void {
  jwksCache = null;
  inflightFetch = null;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Verifies the owner session (cookie or, when enabled, Authorization: Bearer),
 * then re-checks the user in the database so disabled users and suspended
 * tenants are locked out immediately even with a still-valid token.
 */
export function requireOwnerAuth(deps: AppDeps): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cookieToken = getCookie(req, deps.config.ownerAuthCookieName);
      const bearerToken = getBearerToken(req);

      if (cookieToken && bearerToken) {
        sendError(res, 400, "ambiguous_auth");
        return;
      }
      if (bearerToken && !deps.config.allowBearerOwnerAuth) {
        sendError(res, 401, "unauthorized");
        return;
      }

      const token = cookieToken ?? bearerToken;
      if (!token) {
        sendError(res, 401, "unauthorized");
        return;
      }

      let claims: OwnerTokenClaims & jwt.JwtPayload;
      if (deps.config.ownerJwksUri) {
        if (!deps.config.ownerJwksUri.startsWith("https://")) {
          sendError(res, 500, "misconfigured_auth");
          return;
        }
        try {
          claims = await verifyRs256(
            token,
            deps.config.ownerJwksUri,
            deps.config.jwtIssuer,
            deps.config.jwtAudience,
          );
        } catch {
          sendError(res, 401, "unauthorized");
          return;
        }
      } else {
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
