# Owner authentication — contract for Backend and Frontend

This document defines where the owner token comes from and how the backend middleware treats it. Backend and Frontend agents must implement against this contract.

## JWT configuration (backend)

- **Algorithm:** HS256 (symmetric secret).
- **Secret:** `OWNER_JWT_SECRET` environment variable. If unset, the backend uses a default dev secret (`dev-owner-secret`) for local development only.
- **Verification:** `jwt.verify(token, OWNER_JWT_SECRET, { algorithms: ['HS256'] })`. Only HS256 is accepted to avoid algorithm confusion.

## Required JWT claims

| Claim       | Type     | Description                          |
| ----------- | -------- | ------------------------------------ |
| `sub`       | string   | Owner user ID.                       |
| `tenantId`  | string   | Tenant/organization ID.              |
| `propertyIds` | string[] | IDs of properties the owner can access. |

Optional standard claims: `exp`, `iat` (recommended). No `aud`/`iss` enforced by middleware.

---

## 1. Where does the token come from?

### Development

- **Source:** A JWT signed with the same secret the backend uses (`OWNER_JWT_SECRET`, or the backend default `dev-owner-secret`).
- **How to obtain:** Run the dev token helper (see below) or set `VITE_DEV_OWNER_TOKEN` in the frontend `.env` to a valid JWT.
- **How the frontend sends it:** Every request to owner APIs must include the header `Authorization: Bearer <token>`.
- **Storage (dev):** Typically in-memory or `sessionStorage` when using the dev token or “Paste JWT” flow; no OIDC in dev.

### Production

- **Source:** OIDC login (or equivalent). The identity provider issues or is exchanged for a JWT that the backend can verify (same secret or, in a future RS256 setup, public key).
- **Storage:** To be defined by the Frontend agent — e.g. in-memory only (no persistence) or short-lived sessionStorage; avoid long-lived localStorage for tokens.
- **How the frontend sends it:** Same as dev: `Authorization: Bearer <token>` on every owner API request.

---

## 2. What does the middleware look like?

### Request

- **Header:** `Authorization: Bearer <token>` (no fallback header; only Bearer is supported).

### Steps

1. Read `Authorization` header. If missing or not starting with `Bearer `, respond **401 Unauthorized** with body `{ "error": "unauthorized" }`.
2. Extract the token (everything after `Bearer `).
3. Verify the JWT with `OWNER_JWT_SECRET` and `algorithms: ['HS256']`. If verification fails (invalid signature, expired, malformed), respond **401 Unauthorized** with body `{ "error": "unauthorized" }`.
4. Decode claims: `sub` → userId, `tenantId`, `propertyIds` (must be an array of strings; otherwise treat as empty array).
5. Attach to request: `req.owner = { userId, tenantId, propertyIds }`.
6. Call `next()` so the route handler runs with `req.owner` set.

### On failure

- **401 Unauthorized:** Missing token or invalid token (malformed, wrong signature, expired). Response body: `{ "error": "unauthorized" }`.
- **403 Forbidden** is not returned by the middleware. Route handlers perform resource-level checks (e.g. property or submission belongs to the owner) and return 403 when the token is valid but the principal has no access to the requested resource.

### Route handler contract

- All routes under `/v1/owner` are protected by this middleware. Handlers can assume `req.owner` is set and has shape `{ userId: string, tenantId: string, propertyIds: string[] }`.
- Use `req.owner.propertyIds` for `GET /v1/owner/properties` and `GET /v1/owner/properties/:id/submissions`; use `req.owner.userId` and `req.owner.tenantId` when resolving submission → property → owner for `GET /v1/owner/submissions/:id` and `GET /v1/owner/submissions/:id/pdf`.

---

## 3. Dev token helper

To issue a JWT that the backend will accept in development:

- **Script:** `Owner/gen-owner-jwt.js` (or equivalent in the repo).
- **Usage:**  
  `node Owner/gen-owner-jwt.js [--sub owner-123] [--tenantId tenant-abc] [--propertyIds prop-1,prop-2] [--secret <same as OWNER_JWT_SECRET>]`
- **Important:** The signing secret must match the backend. If the backend uses the default `dev-owner-secret`, run the script with `--secret dev-owner-secret` or set `OWNER_JWT_SECRET=dev-owner-secret` when generating the token.
- **Frontend:** Put the printed token in `VITE_DEV_OWNER_TOKEN` in `.env` or paste it into the login UI “Paste owner JWT” field so the app sends it as `Authorization: Bearer <token>`.
