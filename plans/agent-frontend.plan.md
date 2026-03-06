# Frontend Agent — Contracts, Endpoints, MSW, and Dashboard Data Wiring

## Prerequisite

- **Auth checker agent**: token source documented so frontend knows how to obtain and send the Bearer token.
- **Backend agent** (or MSW): API contract implemented so frontend can call or mock it.

## Goal

Add TypeScript contracts and endpoint functions matching the master API contract; add MSW mocks that mirror it; ensure dashboard fetches data on demand and does **not** contain any client-side PDF filling (no pdf-lib, no fillModalFormPdf.ts).

## Master plan reference

- [owner-dashboard-master.plan.md](owner-dashboard-master.plan.md) — API contract table, build order, “PDF server-side only.”

## Tasks (in build order)

### 1. contracts.ts

- Define types matching the API contract:
  - `OwnerPropertiesResponse`: `{ properties: Array<{ id: string; name?: string; address?: string }> }`
  - `SubmissionsListResponse`: `{ submissions: Array<{ id: string; createdAt: string; status: string; tenantName?: string }> }` (align with existing if already defined; add `tenantName?` if in contract)
  - `SubmissionDetailResponse`: `{ id: string; createdAt: string; status: string; payload: Record<string, unknown> }` or a typed payload shape matching registration (fullName, nationality, documentNumber, address, dateOfBirth, checkInDate, checkOutDate, phone?, email?, etc.)
  - PDF: no type needed; response is blob.

### 2. endpoints.ts

- Add (or extend) owner API functions:
  - `fetchOwnerProperties(token: string): Promise<OwnerPropertiesResponse>`
  - `fetchSubmissions(propertyId: string, token: string): Promise<SubmissionsListResponse>` (may already exist; ensure response shape matches contract)
  - `fetchSubmissionDetail(submissionId: string, token: string): Promise<SubmissionDetailResponse>`
  - `downloadPdf(submissionId: string, token: string): Promise<Blob>` (may already exist; ensure it calls `GET /v1/owner/submissions/:id/pdf` and returns blob)
- All requests must send `Authorization: Bearer <token>`. Use existing apiFetch / apiFetchBlob pattern.

### 3. MSW mocks

- Mirror the **exact** API contract so the dashboard works without a real backend:
  - `GET /v1/owner/properties` (or same path as api base) → `{ properties: [{ id, name?, address? }, ...] }`
  - `GET /v1/owner/properties/:id/submissions` → `{ submissions: [{ id, createdAt, status, tenantName? }, ...] }`
  - `GET /v1/owner/submissions/:id` → `{ id, createdAt, status, payload: { fullName, ... } }` (sample payload)
  - `GET /v1/owner/submissions/:id/pdf` → PDF blob (e.g. minimal PDF or sample binary) and optionally set Content-Disposition in response
- Use the same base URL/path as the real API (e.g. /api prefix if applicable).

### 4. Dashboard data wiring (no UI layout work here — that’s UI agent)

- Property strip: wire to `fetchOwnerProperties(token)` (or mock). On load, fetch properties; display as tabs; selected property drives which `propertyId` is used for submissions list and route.
- Submissions list: wire to `fetchSubmissions(propertyId, token)`. When user selects a submission, call `fetchSubmissionDetail(submissionId, token)` and pass payload to the Matkustajailmoitus panel (UI agent owns the panel component).
- Print / Download Form button: on click, call `downloadPdf(submissionId, token)`, receive blob, create object URL, trigger `<a download>`, revoke URL. **Do not** add any client-side PDF filling; do not add pdf-lib or fillModalFormPdf.ts.

## Explicitly out of scope

- **No** `fillModalFormPdf.ts` or any client-side PDF form filling.
- **No** pdf-lib (or similar) dependency in the frontend.
- UI layout, sidebar, topbar, hero block structure, styling (owned by UI agent). This agent only ensures data flows and API/mock alignment.

## Definition of done

- contracts.ts and endpoints.ts match the master API contract.
- MSW mocks mirror the four endpoints and response shapes.
- Dashboard (once UI exists) can: load properties into strip; load submissions for selected property; load submission detail on selection; download PDF via blob with no client-side fill.
