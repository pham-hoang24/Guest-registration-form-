# Guest Registration Frontend

React + Vite + TypeScript frontend for the guest registration platform. Mobile-first registration form (token-gated) and optional owner dashboard.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173. Use `/register/:token` or `/register?token=...` for guest registration.

## Environment variables

| Variable               | Required   | Description                                                                                                |
| ---------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL`    | Production | API base URL (e.g. `/api`). Defaults to `/api` in dev.                                                     |
| `VITE_APP_BASE_URL`    | Production | App base URL for guest links (e.g. `https://app.example.com`). Defaults to `http://localhost:5173` in dev. |
| `VITE_DEV_OWNER_TOKEN` | Optional   | Owner JWT for testing owner APIs without OIDC.                                                             |
| `VITE_MSW_ENABLED`     | Optional   | Set to `true` to enable MSW mocks for missing APIs.                                                        |
| `VITE_OIDC_*`          | Optional   | OIDC config (issuer, clientId, redirectUri) for Phase 2.                                                   |

Copy `.env.example` to `.env` and adjust.

## Scripts

- `npm run dev` – Start dev server (proxies `/api` to backend)
- `npm run build` – Production build
- `npm run preview` – Preview production build
- `npm run test` – Unit tests (Vitest)
- `npm run test:e2e` – E2E tests (Playwright)
- `npm run dev:e2e` – Dev server with E2E mode (loads `.env.e2e`)

## API endpoints

| Endpoint                                     | Auth             | Description                |
| -------------------------------------------- | ---------------- | -------------------------- |
| `POST /v1/guest/register`                    | Bearer token     | Submit registration        |
| `GET /v1/owner/submissions/:id/pdf`          | Bearer owner JWT | Download PDF               |
| `GET /v1/owner/properties/:id/submissions`   | Bearer owner JWT | List submissions (mocked)  |
| `POST /v1/owner/properties/:id/guest-tokens` | Bearer owner JWT | Create guest link (mocked) |

## Mock mode

Set `VITE_MSW_ENABLED=true` to enable MSW. MSW mocks only:

- `GET /v1/owner/properties/:id/submissions`
- `POST /v1/owner/properties/:id/guest-tokens`

Real endpoints (`POST /v1/guest/register`, `GET /v1/owner/submissions/:id/pdf`) passthrough to the backend.

## Token-in-URL sanitization

When a guest opens a registration link with a token in the URL:

1. The app reads the token once from the path or query.
2. It immediately calls `history.replaceState` to remove the token from the URL.
3. The token is never re-rendered or stored in browser storage.

This reduces leakage via history, referrer, and logs.

## PII handling

- No PII stored in `localStorage` or `sessionStorage`.
- No PII logged to console.
- Form data is submitted directly to the API and not retained in the client after success.
- No third-party scripts on the guest registration page.

## Running with backend

1. Start the backend: `cd ../backend && npm run dev` (port 3000).
2. Start the frontend: `npm run dev` (port 5173).
3. The Vite proxy forwards `/api` to the backend.

## E2E tests

```bash
npm run test:e2e
```

Uses `dev:e2e` which loads `.env.e2e` (includes `VITE_DEV_OWNER_TOKEN` for owner tests). Ensure no other process is using port 5173.
