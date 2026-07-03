# Threat Model

Assets: guest identity data (names, birth dates, document numbers), registration PDFs,
owner credentials, audit trail integrity.

| # | Threat | Mitigations | Residual risk / follow-up |
|---|--------|-------------|---------------------------|
| 1 | Leaked registration link | 32-byte random token; link can be DISABLED or expire (`expiresAt`); link grants submit-only access, never read access to prior submissions | A leaked active link permits spam submissions → rate limiting; consider one-time links |
| 2 | Cross-tenant data access (bug) | Every owner query scoped by `tenantId`; 404 on mismatch; tests assert cross-tenant denial | RLS in Postgres as second layer (not yet implemented) |
| 3 | Stolen owner JWT | 12h expiry; HS256 with issuer/audience checks; DB re-check on every request (disabled user / suspended tenant locks out immediately); sessionStorage (cleared on tab close) | No token revocation list yet; move to short-lived tokens + refresh |
| 4 | Malicious owner probing other tenants | Same as #2; RBAC on top; every view/download audited with actor id and hashed IP | Anomaly detection on audit log volume |
| 5 | Plaintext PDF leakage | PDFs exist only in memory; storage receives ciphertext only; download streamed with `cache-control: no-store`; blob verified to not start with `%PDF-` in tests | OS-level memory dumps out of scope for MVP |
| 6 | Bad key handling | DEK is random per PDF, zeroed after use; only the wrapped DEK is stored; master key never leaves the KMS provider abstraction; wrong master key fails as keyId mismatch | Local KMS master key lives in `.env` — dev only; production must use Azure Key Vault + rotation |
| 7 | Logs containing PII | Request logger logs method/path/status only; registration tokens redacted from paths; audit metadata is a reviewed allowlist; IP/user-agent stored as SHA-256 hashes; tests assert no names/emails/doc numbers in audit rows | Unsalted hashes of low-entropy values (IPs) are reversible by brute force — acceptable trade-off for correlation; consider keyed HMAC |
| 8 | Expired data not deleted | `retainUntil`/`deleteAfter` set at creation; `runRetentionCleanup` deletes blobs + PDF records + guest rows, clears contact fields, marks DELETED, audits | Not yet scheduled — must be wired to cron/Container Apps job before production |
| 9 | Brute-force login | Rate limit 10/15min per IP; bcrypt (cost 12); identical generic error + constant-work hashing for unknown emails; failures audited | Add account lockout / CAPTCHA at scale |
| 10 | Brute-force token guessing | 256-bit tokens (guessing infeasible); rate limit on public endpoints; invalid/expired/disabled indistinguishable (404) | — |

## Trust boundaries

- Guest → API: unauthenticated; only the token authorizes a submission.
- Owner → API: JWT + DB status re-check + RBAC.
- API/worker → storage & KMS: providers receive ciphertext / wrapped keys only.
- Database: assumed honest-but-curious for PDF content (sees only ciphertext + wrapped DEKs
  for PDFs and document numbers; other guest fields are plaintext columns — see security.md).
