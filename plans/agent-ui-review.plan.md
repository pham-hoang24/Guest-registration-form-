# UI and Review Agent — Dashboard Layout and Matkustajailmoitus Panel

## Prerequisite

- **Frontend agent** has provided (or will provide) contracts, endpoints, and MSW mocks. Data wiring (fetch properties, submissions, detail, PDF blob) is either done or clearly specified so this agent can assume those functions exist and use them in the UI.

## Goal

Implement the owner dashboard UI to match the PropVault reference ([property-owner-dashboard.html](property-owner-dashboard.html)): layout shell, property strip, hero left (property summary), hero right (Matkustajailmoitus read-only panel + Print / Download Form button). Ensure no PII in initial HTML; all guest data comes from fetched submission detail. Ensure “Print / Download Form” only triggers the PDF blob download (no client-side PDF fill). Perform a short review checklist for consistency with the master plan.

## Master plan reference

- [owner-dashboard-master.plan.md](owner-dashboard-master.plan.md) — Build order, “PDF server-side only,” “no PII in HTML,” property strip wired to GET /v1/owner/properties.

## Tasks (in build order)

### 1. Dashboard UI shell (layout only)

- **Shell:** CSS Grid: sidebar (e.g. 220px) + main (1fr). Topbar in main column, sticky if desired.
- **Sidebar:** PropVault logo (“PropVault”, “Owner Portal”); nav sections (e.g. Overview: Dashboard, Properties, Tenants; Operations: Matkustajailmoitus); user card at bottom (avatar, name, “Property Owner”). Use auth context or placeholder for name.
- **Topbar:** “Good morning, [Name]” or “Owner Dashboard”; current date/time; placeholder actions (e.g. “Export Report”, “+ Add Property”) if desired.
- **Main content area:** Placeholder or section title “01 — Property & Tenant — Matkustajailmoitus”. No data yet.

### 2. Hero block and property strip

- **Property strip:** Horizontal tabs of properties. Data source: list from `GET /v1/owner/properties` (or mock). Selecting a tab sets the current property (and route/state for submissions). If list is empty, show a single tab from route param or “No properties.”
- **Hero left:** Property summary (name, address, optional stats: rent, lease end, floor area, status). Use first property or selected property; placeholder “—” for fields the backend doesn’t provide yet.
- **Hero right:** Reserve space for Matkustajailmoitus card (next step).

### 3. Matkustajailmoitus panel

- **Title:** “Matkustajailmoitus” / “Passenger Registration Card · Laki majoitustoiminnasta 308/2006” and note “Filled by tenant · Read-only view for owner.”
- **Tenant row:** Avatar (initials from fullName), guest full name, submission date or “Tenant since …”, optional rent/lease placeholder.
- **Read-only grid:** Labels and values for: Surname, Given names, Date of birth, Nationality, Passi/ID (document number), Home address, Arrival, Departure; optionally Country of entry, Purpose. Values come **only** from the fetched submission detail payload (no PII in HTML until fetched). If no submission selected or no payload, show “—” or empty.
- **Actions row:** “Print / Download Form” button; note “Tenant-submitted data — owner view only”; submission date or “Submitted …”.
- **Print / Download Form button:** On click, call the endpoint that returns the PDF blob (e.g. `downloadPdf(submissionId, token)`); on response, create object URL, trigger download via `<a download>`, revoke URL. **Do not** use any client-side PDF filling or pdf-lib.

### 4. Submissions list

- Table or list of submissions for the selected property (id, createdAt, status, optional tenantName). On row/card click, set selected submission and trigger fetch of submission detail; then render the Matkustajailmoitus panel with that payload. Data from `GET /v1/owner/properties/:id/submissions` and `GET /v1/owner/submissions/:id`.

### 5. Styling

- Reuse reference design tokens (e.g. `--ink`, `--paper`, `--cream`, `--accent`, `--gold`, `--muted`, `--border`, `--card`) and typography (DM Serif Display, DM Mono, Outfit) via Tailwind or a small CSS file. For owner dashboard only, loading Google Fonts (or self-hosted) for this page is acceptable.

### 6. Review checklist

- [ ] No PII in initial HTML; guest data only appears after fetch of submission detail.
- [ ] No `fillModalFormPdf.ts`, no pdf-lib, no client-side PDF form filling; “Print / Download Form” only requests blob and downloads it.
- [ ] Property strip is wired to `GET /v1/owner/properties` (or mock), not only to route param.
- [ ] Matkustajailmoitus panel is driven by submission detail response; empty state when nothing selected.
- [ ] All owner API calls send the auth token (Bearer). Unauthenticated state shows sign-in or placeholder as per existing auth context.

## Out of scope

- Backend endpoints. Auth middleware. MSW mock implementation (Frontend agent). API contract types (Frontend agent). Register form changes.

## Definition of done

- Dashboard shell, property strip, hero left/right, Matkustajailmoitus panel, and submissions list are implemented and wired to the data layer (properties, submissions, submission detail, PDF download).
- Review checklist completed and any issues fixed.
- UI matches reference layout and behavior within scope; PDF is server-side only; no PII in initial HTML.
