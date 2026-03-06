# Auth Checker Agent — Owner Authentication

## Goal

Define and implement owner authentication so that Backend and Frontend agents can rely on a single contract. **Nothing else works without this.** No owner endpoint code should be written until token source and middleware are defined and implemented.

## Inputs

- Master plan: [owner-dashboard-master.plan.md](owner-dashboard-master.plan.md)
- Existing backend: backend/src/routes/owner.ts (currently uses getOwnerFromRequest and JWT verify with OWNER_JWT_SECRET)

## Deliverables

1. **Document: Where does the token come from?**
   - Dev: e.g. VITE_DEV_OWNER_TOKEN / OWNER_JWT_SECRET-signed JWT in env; frontend sends it as Authorization: Bearer token.
   - Prod: e.g. OIDC login callback; where is the JWT stored (in-memory vs sessionStorage) and how does the frontend attach it to requests?
   - One short section per environment so Backend and Frontend know how to obtain and send the token.

2. **Document: What does the middleware look like?**
   - Request: Authorization: Bearer token (or fallback header if any).
   - Steps: extract token, verify (e.g. JWT with OWNER_JWT_SECRET), decode claims (e.g. sub, tenantId, propertyIds), attach to request (e.g. req.owner = { userId, tenantId, propertyIds }) or call next() with owner context.
   - On failure: 401 Unauthorized (missing or invalid token). No 403 at this stage (403 is for valid token but no access to this resource, done in route handlers).

3. **Implement (or refactor) middleware in backend**
   - Ensure all owner routes are protected by this middleware.
   - Ensure route handlers can access req.owner (or equivalent) to check propertyIds for GET /v1/owner/properties, GET /v1/owner/properties/:id/submissions, and to resolve submission to property to owner for GET /v1/owner/submissions/:id and GET /v1/owner/submissions/:id/pdf.

4. **Optional: Dev token helper**
   - If not already present: document or add a way to issue a dev JWT that includes propertyIds so the frontend can call owner APIs locally (e.g. script or env that encodes a token the backend will accept).

## Out of scope for this agent

- Implementing the actual owner API handlers (list properties, list submissions, get submission, get PDF). Only auth/middleware and the contract they rely on.
- Frontend login UI or OIDC integration (can be documented as to be implemented if not existing).

## Definition of done

- Written doc (or inline comments) answering where does the token come from and what does the middleware look like.
- Middleware implemented and applied to owner routes; 401 returned when token is missing or invalid.
- Backend and Frontend agents can read the doc and implement their parts against this contract.
