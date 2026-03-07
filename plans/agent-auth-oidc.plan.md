# Auth OIDC Agent — Owner JWT: HS256 → JWKS

## Goal

Replace the HS256 shared-secret owner JWT verification in `backend/src/middleware/ownerAuth.ts` with JWKS-based RS256 verification (Azure AD B2C or Auth0). The HS256 path must remain available for local dev via an env flag.

## Prerequisites

None. Runs in parallel with other agents.

## Master plan reference

- [`production-readiness-master.plan.md`](production-readiness-master.plan.md)

## Context — what exists today

`backend/src/middleware/ownerAuth.ts`:
- Uses `jwt.verify(token, OWNER_JWT_SECRET, { algorithms: ["HS256"] })`
- `OWNER_JWT_SECRET` is a shared string env var
- Extracts `{ sub, tenantId, propertyIds }` from claims → `req.owner`
- Returns 401 for missing/invalid token
- **This is correct behavior and must be preserved** — only the verification mechanism changes

`Owner/gen-owner-jwt.js`:
- Script that signs a JWT with `OWNER_JWT_SECRET` for dev/testing
- Must continue to work for local dev

## Tasks

### 1. Install `jwks-rsa`

```bash
npm install jwks-rsa
npm install --save-dev @types/jwks-rsa
```

### 2. Implement JWKS verification path in `ownerAuth.ts`

Strategy: if `OIDC_JWKS_URI` is set, use JWKS. If not set, fall back to HS256 with `OWNER_JWT_SECRET` for local dev. Never allow HS256 in production (add a startup check).

```typescript
import jwksRsa from "jwks-rsa";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import type { OwnerIdentity } from "../types.js";

// JWKS client (initialized once)
let jwksClient: jwksRsa.JwksClient | null = null;

const getJwksClient = () => {
  if (!jwksClient && process.env.OIDC_JWKS_URI) {
    jwksClient = jwksRsa({
      jwksUri: process.env.OIDC_JWKS_URI,
      cache: true,
      cacheMaxAge: 600_000,       // 10 min
      rateLimit: true,
      jwksRequestsPerMinute: 10
    });
  }
  return jwksClient;
};

const getSigningKey = (header: jwt.JwtHeader): Promise<string> => {
  const client = getJwksClient();
  if (!client) throw new Error("JWKS client not initialized");
  return new Promise((resolve, reject) => {
    client.getSigningKey(header.kid, (err, key) => {
      if (err) return reject(err);
      resolve(key!.getPublicKey());
    });
  });
};

const verifyOidc = (token: string): Promise<jwt.JwtPayload> => {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      (header, callback) => {
        getSigningKey(header)
          .then(key => callback(null, key))
          .catch(callback);
      },
      {
        algorithms: ["RS256"],
        audience: process.env.OIDC_AUDIENCE,
        issuer: process.env.OIDC_ISSUER
      },
      (err, decoded) => {
        if (err || !decoded) return reject(err ?? new Error("Invalid token"));
        resolve(decoded as jwt.JwtPayload);
      }
    );
  });
};

const verifyDev = (token: string): jwt.JwtPayload => {
  const secret = process.env.OWNER_JWT_SECRET;
  if (!secret) throw new Error("OWNER_JWT_SECRET not set");
  return jwt.verify(token, secret, { algorithms: ["HS256"] }) as jwt.JwtPayload;
};

function parseOwnerFromPayload(decoded: jwt.JwtPayload): OwnerIdentity {
  return {
    userId: String(decoded.sub ?? ""),
    tenantId: String(decoded.tenantId ?? ""),
    propertyIds: Array.isArray(decoded.propertyIds)
      ? decoded.propertyIds.map(String)
      : []
  };
}

export async function requireOwnerAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const token = header.slice(7);

  try {
    const useOidc = Boolean(process.env.OIDC_JWKS_URI);
    const decoded = useOidc
      ? await verifyOidc(token)
      : verifyDev(token);
    req.owner = parseOwnerFromPayload(decoded);
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
}
```

### 3. Add production startup guard

In `backend/src/server.ts`, add a startup check:
```typescript
if (process.env.NODE_ENV === "production" && !process.env.OIDC_JWKS_URI) {
  console.error("FATAL: OIDC_JWKS_URI must be set in production. HS256 is not allowed.");
  process.exit(1);
}
```

### 4. Update `ownerAuth` to be `async`

The OIDC verification path is async. Update the middleware signature from sync to async and verify the route handler call still works (Express accepts async middleware when errors are passed to `next(err)`).

The function signature changes from:
```typescript
export function requireOwnerAuth(req, res, next): void
```
to:
```typescript
export async function requireOwnerAuth(req, res, next): Promise<void>
```

### 5. Document the token claim contract

Add a comment block in `ownerAuth.ts` specifying exactly what claims the JWT must contain:
```
Required claims:
  sub        (string) — user identifier
  tenantId   (string) — tenant UUID the owner belongs to
  propertyIds (string[]) — list of property UUIDs the owner can access

For OIDC: these claims must be present as custom claims in the token.
In Azure AD B2C: configure custom policy or user flow to include tenantId and propertyIds.
In Auth0: add them via Actions/Rules.
```

### 6. Update `Owner/gen-owner-jwt.js` (dev token helper)

Ensure the script still works for local dev:
- It signs with `OWNER_JWT_SECRET` using HS256.
- Add a comment: "This script is for local dev only. In production, tokens are issued by the OIDC provider."
- If any changes were needed to the claim structure in step 5, reflect them here.

### 7. Environment variables

Add to `backend/.env.example`:
```
# OIDC (production)
OIDC_JWKS_URI=https://your-tenant.b2clogin.com/your-tenant.onmicrosoft.com/policy/discovery/v2.0/keys
OIDC_AUDIENCE=your-app-client-id
OIDC_ISSUER=https://your-tenant.b2clogin.com/your-tenant-id/v2.0/

# Dev only (HS256 fallback — used when OIDC_JWKS_URI is not set)
OWNER_JWT_SECRET=dev-owner-secret
```

## Non-negotiable constraints

- `HS256` path must NOT be usable when `NODE_ENV=production` — startup exits if `OIDC_JWKS_URI` is missing.
- `jwksClient` must have `cache: true` to avoid JWKS endpoint hammering.
- The middleware must still return `401` for missing/invalid token. No change to the response contract.
- `req.owner` shape (`userId`, `tenantId`, `propertyIds`) must not change — all downstream code depends on it.
- Do not change `requireOwnerAuth` export name — it is imported by `owner.ts` as-is.

## Definition of done

- `requireOwnerAuth` verifies RS256 via JWKS when `OIDC_JWKS_URI` is set.
- Falls back to HS256 when `OIDC_JWKS_URI` is unset (local dev).
- Production startup exits if `NODE_ENV=production` and `OIDC_JWKS_URI` is missing.
- `gen-owner-jwt.js` still produces tokens that pass the HS256 dev path.
- Existing `authz.test.ts` and owner route tests still pass (they use HS256 dev path).
