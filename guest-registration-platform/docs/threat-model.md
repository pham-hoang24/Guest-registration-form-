# Threat Model

Assets: guest identity data (names, birth dates, document numbers), registration PDFs,
owner credentials, audit trail integrity.

| # | Threat | Mitigations | Residual risk / follow-up |
|---|--------|-------------|---------------------------|
| 1 | Leaked registration link | 32-byte random token stored only as SHA-256 `tokenHash` (raw URL shown once, `no-store`, never logged/audited); link can be REVOKED or expire (`expiresAt`); one ACTIVE link per property (regenerating revokes the prior one); link grants submit-only access, never read access to prior submissions | A leaked active link permits spam submissions → rate limiting; consider one-time links |
| 2 | Cross-tenant data access (bug) | Every owner query scoped by `tenantId`; 404 on mismatch; tests assert cross-tenant denial | RLS in Postgres as second layer (not yet implemented) |
| 3 | Stolen owner JWT | 4h expiry; HS256 (or RS256/JWKS when `OWNER_JWKS_URI` is set — no downgrade fallback between the two); issuer/audience checks; DB re-check on every request (disabled user / suspended tenant locks out immediately); session is an httpOnly, `SameSite=Strict` cookie, never readable by JavaScript; Bearer header only accepted when `ALLOW_BEARER_OWNER_AUTH=true` (off by default in production); cookie+Bearer sent together is rejected (`ambiguous_auth`) | No server-side token revocation list yet — logout clears the cookie but the token stays valid until its 4h expiry; add a session table / `jti` denylist if needed |
| 4 | Malicious owner probing other tenants | Same as #2; RBAC on top; every view/download audited with actor id and hashed IP | Anomaly detection on audit log volume |
| 5 | Plaintext PDF leakage | PDFs exist only in memory; storage receives ciphertext only; download streamed with `cache-control: no-store`; blob verified to not start with `%PDF-` in tests | OS-level memory dumps out of scope for MVP |
| 6 | Bad key handling | DEK is random per PDF, zeroed after use; only the wrapped DEK is stored; master key never leaves the KMS provider abstraction; wrong master key fails as keyId mismatch | Local KMS master key lives in `.env` — dev only; production must use Azure Key Vault + rotation |
| 7 | Logs containing PII | Request logger logs method/path/status only; registration tokens redacted from paths; audit metadata is a reviewed allowlist; IP/user-agent stored as SHA-256 hashes; tests assert no names/emails/doc numbers in audit rows | Unsalted hashes of low-entropy values (IPs) are reversible by brute force — acceptable trade-off for correlation; consider keyed HMAC |
| 8 | Expired data not deleted | `retainUntil`/`deleteAfter` set at creation; `runRetentionCleanup` deletes blobs + PDF records + guest rows, clears contact fields, marks DELETED, audits; `RETENTION_DELETED_SUBMISSION` audit event written per deletion; dry-run preview available via `pnpm --filter @gr/worker retention:dry-run` | Schedule `retention:run` as an Azure Container Apps Job (cron `0 2 * * *`) before production; see `docs/retention-policy.md` |
| 9 | Brute-force login | Rate limit 10/15min per IP, backed by a Redis store (distributed across instances) when `REDIS_URL` is set; bcrypt (cost 12); identical generic error + constant-work hashing for unknown emails; failures audited | Add account lockout / CAPTCHA at scale |
| 10 | Brute-force token guessing | 256-bit tokens (guessing infeasible); rate limit on public endpoints; invalid/expired/disabled indistinguishable (404) | Public endpoint limiters (`publicGetRateLimit`/`publicPostRateLimit`) are still in-memory and reset per instance — the login limiter is the one wired to Redis so far; only a concern once the API runs more than one replica |
| 11 | CSRF against owner mutations | Cookie-authenticated mutating requests require an `X-CSRF-Token` header bound to the session (double-submit); cookie is `SameSite=Strict`; Bearer-auth requests skip CSRF (not ambient-credential requests). Denied requests never perform the side effect (e.g. active-link regeneration) | Token is session-derived, not per-request rotating — acceptable for the double-submit model |
| 12 | Misconfigured public origin / capability-URL leakage | `PUBLIC_APP_URL` must parse via `new URL()`; production rejects non-HTTPS and localhost/private/link-local hosts, so registration capability URLs cannot be minted against an internal origin | — |

## Trust boundaries

- Guest → API: unauthenticated; only the token authorizes a submission.
- Owner → API: session cookie (or gated Bearer) + DB status re-check + RBAC; cookie mutations
  additionally require a session-bound CSRF token.
- API/worker → storage & KMS: providers receive ciphertext / wrapped keys only.
- Database: assumed honest-but-curious for PDF content (sees only ciphertext + wrapped DEKs
  for PDFs and document numbers; other guest fields are plaintext columns — see security.md).
- Redis (rate limiting): internal-network-only, no public/unauthenticated access. Keys use a
  hashed registration token + IP, never the raw token, and carry the limiter's TTL.
