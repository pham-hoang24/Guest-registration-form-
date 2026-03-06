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
  - `OwnerPropertiesResponse`: `{ properties: Array<{ id: string; name?: string; address?: string; pendingCount?: number }> }`
  - `PropertyDetailResponse` (for hero-left): `{ id: string; name?: string; address?: string; status?: string; rent?: string; leaseEnd?: string; floorArea?: string; inspection?: string }` when `GET /v1/owner/properties/:id` is in scope.
  - `SubmissionsListResponse`: `{ submissions: Array<{ id: string; createdAt: string; status: string; tenantName?: string }> }` (align with existing if already defined; add `tenantName?` if in contract)
  - `SubmissionDetailResponse`: `{ id: string; createdAt: string; status: string; payload: Record<string, unknown> }` or a typed payload shape matching registration (fullName, nationality, documentNumber, address, dateOfBirth, checkInDate, checkOutDate, phone?, email?, etc.)
  - PDF: define `PdfDownloadResult`: `{ blob: Blob; filename: string }`. The PDF endpoint returns a blob and `Content-Disposition`; the client must return both so callers (e.g. download button) can use the suggested filename.

### 2. endpoints.ts

- Add (or extend) owner API functions:
  - `fetchOwnerProperties(token: string): Promise<OwnerPropertiesResponse>`
  - `fetchPropertyDetail(propertyId: string, token: string): Promise<PropertyDetailResponse>` when backend exposes `GET /v1/owner/properties/:id` (for hero-left).
  - `fetchSubmissions(propertyId: string, token: string): Promise<SubmissionsListResponse>` (may already exist; ensure response shape matches contract)
  - `fetchSubmissionDetail(submissionId: string, token: string): Promise<SubmissionDetailResponse>`
  - `downloadSubmissionPdf(submissionId: string, token: string): Promise<PdfDownloadResult>` — calls `GET /v1/owner/submissions/:id/pdf`, returns `{ blob, filename }` (parse `filename` from response `Content-Disposition` header). Define this signature once; downstream (e.g. Print/Download button) consumes it as-written with no backwards edit to this file.
- All requests must send `Authorization: Bearer <token>`. Use existing apiFetch / apiFetchBlob pattern. For the PDF GET request, do **not** send `Content-Type: application/json`; omit body-related headers or use only request-appropriate headers.

### 3. MSW mocks

- Mirror the **exact** API contract so the dashboard works without a real backend:
  - `GET /v1/owner/properties` (or same path as api base) → `{ properties: [{ id, name?, address? }, ...] }` (optional `pendingCount?` per property if contract includes it)
  - `GET /v1/owner/properties/:id/submissions` → `{ submissions: [{ id, createdAt, status, tenantName? }, ...] }`
  - `GET /v1/owner/submissions/:id` → `{ id, createdAt, status, payload: { fullName, ... } }` — use **complete** sample payload objects (no trailing `...` or incomplete stubs; fill out every mock submission entry so agents do not copy literal placeholders).
  - `GET /v1/owner/submissions/:id/pdf` → PDF blob and `Content-Disposition` with filename. **Mock PDF stub:** Use a single **blank 1-page PDF** with placeholder text only (e.g. "SAMPLE — not a real submission"). No PII, no realistic filled form data. Commit this stub file to the repo (e.g. `public/mock-assets/filled-stub.pdf` or similar) and reference it from the mock handler.
- Use the same base URL/path as the real API (e.g. /api prefix if applicable).

### 4. Dashboard data wiring (no UI layout work here — that’s UI agent)

- Property strip: wire to `fetchOwnerProperties(token)` (or mock). On load, fetch properties; display as tabs; selected property drives which `propertyId` is used for submissions list and route.
- Submissions list: wire to `fetchSubmissions(propertyId, token)`. When user selects a submission, call `fetchSubmissionDetail(submissionId, token)` and pass payload to the Matkustajailmoitus panel (UI agent owns the panel component).
- Print / Download Form button: on click, call `downloadSubmissionPdf(submissionId, token)`, receive `{ blob, filename }`, create object URL, trigger `<a download={filename}>`, revoke URL. **Do not** add any client-side PDF filling; do not add pdf-lib or fillModalFormPdf.ts.

## Explicitly out of scope

- **No** `fillModalFormPdf.ts` or any client-side PDF form filling.
- **No** pdf-lib (or similar) dependency in the frontend.
- UI layout, sidebar, topbar, hero block structure, styling (owned by UI agent). This agent only ensures data flows and API/mock alignment.

## Definition of done

- contracts.ts and endpoints.ts match the master API contract.
- MSW mocks mirror the four endpoints and response shapes.
- Dashboard (once UI exists) can: load properties into strip (with optional pendingCount for badge); load property detail for hero-left when endpoint exists; load submissions for selected property; load submission detail on selection; download PDF via `downloadSubmissionPdf` returning `{ blob, filename }` with no client-side fill.
