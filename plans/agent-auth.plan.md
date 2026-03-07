# Auth Checker Agent — Owner Authentication

> **STATUS:** Core auth middleware is **DONE** (HS256). The remaining work is upgrading to OIDC/JWKS for production.
> See [`agent-auth-oidc.plan.md`](agent-auth-oidc.plan.md) for the OIDC upgrade task.

## Current state (as of last implementation)

- `backend/src/middleware/ownerAuth.ts` — **IMPLEMENTED**
  - `requireOwnerAuth` middleware: extracts `Authorization: Bearer <token>`, verifies with `OWNER_JWT_SECRET` (HS256), attaches `req.owner = { userId, tenantId, propertyIds }`, returns 401 on failure.
  - Applied to all owner routes via `router.use(requireOwnerAuth)` in `backend/src/routes/owner.ts`.
- `Owner/gen-owner-jwt.js` — **EXISTS**: signs a dev JWT with `OWNER_JWT_SECRET`.
- **HS256 with a shared secret is MVP only.** Not safe for production (anyone with the secret can forge any identity).

## Goal

Document the auth contract for Backend and Frontend agents; identify what still needs production hardening.

## Inputs

- Master plan: [owner-dashboard-master.plan.md](owner-dashboard-master.plan.md)
- Existing middleware: `backend/src/middleware/ownerAuth.ts` (HS256, complete)
- Production upgrade plan: [`agent-auth-oidc.plan.md`](agent-auth-oidc.plan.md)

## Auth contract (for Backend and Frontend agents to rely on)

**Token source:**
- Dev: `Owner/gen-owner-jwt.js` signs a JWT with `OWNER_JWT_SECRET`. Frontend sends as `Authorization: Bearer <token>`. Store in memory or `sessionStorage` (never `localStorage` for sensitive apps).
- Prod: OIDC provider (Azure AD B2C or Auth0) issues JWT after login. See `agent-auth-oidc.plan.md` for upgrade path.

**Middleware contract:**
- Request header: `Authorization: Bearer <token>`
- On valid token: `req.owner = { userId: string, tenantId: string, propertyIds: string[] }` — available in all route handlers.
- On missing or invalid token: `401 { error: "unauthorized" }` — no details leaked.
- 403 (forbidden) is NOT the middleware's job — it is the route handler's job when `propertyId` is not in `req.owner.propertyIds`.

**Claim shape (JWT payload):**
```json
{
  "sub": "<userId>",
  "tenantId": "<tenantUUID>",
  "propertyIds": ["<propertyUUID>", ...],
  "iat": ...,
  "exp": ...
}
```

## Remaining tasks

1. **Verify dev flow works end-to-end**: Run `gen-owner-jwt.js`, call a protected route, confirm 200 vs 401 behavior.
2. **Production OIDC upgrade**: See [`agent-auth-oidc.plan.md`](agent-auth-oidc.plan.md) — swap HS256 to JWKS RS256, add startup guard, update env vars.

## Out of scope for this agent

- Implementing the actual owner API handlers (list properties, list submissions, get submission, get PDF). That is `agent-backend.plan.md`.
- Frontend login UI or OIDC integration. That is `agent-auth-oidc.plan.md`.

## Definition of done

- Auth contract above is correct and confirmed against actual middleware code.
- `requireOwnerAuth` applied to all `/v1/owner/*` routes.
- Dev token helper (`gen-owner-jwt.js`) produces tokens the backend accepts.
- OIDC upgrade tracked in `agent-auth-oidc.plan.md`.
