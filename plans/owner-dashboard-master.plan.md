# Owner Dashboard — Master Plan

## Principles

- **Backend** stores tenant data in a database; exposes authenticated owner APIs; generates and serves the Matkustajailmoitus PDF server-side over HTTPS.
- **Authentication** — only the property owner can access their properties and submissions. Before implementing owner endpoints, the auth checker agent must define: where the token comes from and what the middleware looks like (see Auth section below).
- **PDF is server-side only.** The frontend never fills PDFs. It calls `GET /v1/owner/submissions/:id/pdf`, receives the blob, and downloads it. There is **no** `fillModalFormPdf.ts` utility and **no** pdf-lib dependency in the frontend.
- **Frontend contains no PII** in initial HTML; all data is fetched on demand via authenticated API calls.

---

## API contract (authoritative)

| Endpoint | Auth | Response | Error cases |
| -------- | ---- | -------- | ----------- |
| `GET /v1/owner/properties` | Bearer JWT | `{ properties: [{ id, name?, address?, pendingCount? }] }` | 401, 403 |
| `GET /v1/owner/properties/:id` | Bearer JWT | `{ id, name?, address?, status?, rent?, leaseEnd?, floorArea?, inspection? }` (for hero-left property summary) | 401, 403, 404 |
| `GET /v1/owner/properties/:id/submissions` | Bearer JWT | `{ submissions: [{ id, createdAt, status, tenantName? }] }` | 401, 403 |
| `GET /v1/owner/submissions/:id` | Bearer JWT | `{ id, createdAt, status, payload: { fullName, nationality, documentNumber, address, dateOfBirth, checkInDate, checkOutDate, phone?, email?, ... } }` | 401, 403, 404 |
| `GET /v1/owner/submissions/:id/pdf` | Bearer JWT | PDF blob + `Content-Disposition: attachment; filename="Matkustajailmoitus_Surname_GivenNames.pdf"` | 401, 403, 404 |

---

## Authentication (must be defined before owner endpoint code)

- **Current assumption:** A login flow exists; the owner obtains a JWT (or session) somehow.
- **Before writing any owner endpoint code**, the following must be answered and implemented:
  - **Where does the token come from?** (e.g. OIDC callback storing JWT in memory/sessionStorage, or dev token from env, or session cookie.)
  - **What does the middleware look like?** (e.g. extract `Authorization: Bearer <token>`, verify JWT, attach `req.owner = { userId, tenantId, propertyIds }`, or return 401. Then per-route checks that `propertyId` or `submissionId` belongs to the owner.)
- The **Auth checker agent** is responsible for documenting and implementing this contract so Backend and Frontend can rely on it.

---

## Build order

1. **Auth middleware first** — nothing else works without it. Define token source and middleware; implement middleware in backend.
2. **Backend endpoints + DB queries** — `GET /v1/owner/properties` (with optional `pendingCount`), `GET /v1/owner/properties/:id` (property detail for hero-left), `GET /v1/owner/properties/:id/submissions`, `GET /v1/owner/submissions/:id`, `GET /v1/owner/submissions/:id/pdf` (server-side fill of modal form template).
3. **MSW mocks** that mirror those exact API contracts (for frontend dev without backend).
4. **Frontend `contracts.ts` and `endpoints.ts`** — types and fetch functions matching the table above.
5. **Dashboard UI shell** — sidebar, topbar, layout only (no data).
6. **Hero block with property strip** — wired to `GET /v1/owner/properties` (or mock).
7. **Matkustajailmoitus panel** — wired to `GET /v1/owner/submissions/:id` on submission selection (or mock).
8. **Print / Download Form button** — wired to `GET /v1/owner/submissions/:id/pdf`; receive blob, trigger download. No client-side PDF fill.

---

## Property strip — data source

- **Backend must provide** `GET /v1/owner/properties` returning the list of properties the owner can access. The property strip in the dashboard is wired to this endpoint (not to the route param only). Route can remain `/owner/properties/:propertyId/submissions` for the selected property; the strip populates from the properties list.

---

## PDF (server-side only)

- Backend loads the modal form template ([modal form.pdf](modal form.pdf)), fills it with payload from DB (Text1–Text11, Check Box1–4, etc.), flattens, and returns the bytes with `Content-Disposition`.
- Frontend: single flow — call PDF endpoint, get blob, create object URL, `<a download>`, revoke URL. No `fillModalFormPdf.ts`, no pdf-lib in frontend.

---

## Name parsing (canonical rule)

- **fullName → surname and given names:** Last space-delimited token = surname; everything before = given names. Single-token names: full string = given name, surname = empty. Do not attempt cultural or locale-specific name-order detection. Both backend (PDF filename, Text1/Text2 fill) and frontend (tenant avatar initials, panel labels) must use this same rule — see Backend and UI agent plans.

## Reference

- UI reference: [property-owner-dashboard.html](property-owner-dashboard.html) (sidebar, topbar, hero with property strip, Matkustajailmoitus read-only panel, Print / Download Form button).
- Guest form: [frontend/src/pages/Register.tsx](frontend/src/pages/Register.tsx). Payload shape defines what is stored and what appears in submission detail and PDF.
