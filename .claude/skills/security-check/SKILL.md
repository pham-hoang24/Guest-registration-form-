---
name: security-check
description: Focused security review of changed files against this project's threat model (crypto, RBAC, audit logs)
---

Use the security-reviewer subagent to review the current `git diff HEAD` with the following context:

**Threat model**: `guest-registration-platform/docs/threat-model.md`
**Retention policy**: `guest-registration-platform/docs/retention-policy.md`

**Focus areas (in priority order):**
1. **Crypto integrity**: AAD correctness (all required fields present + sorted), DEK never logged or returned in responses, nonce never reused, ciphertext hash verified before decrypt
2. **Tenant isolation**: Every Prisma query must filter by `tenantId`; no cross-tenant data leaks
3. **Auth enforcement**: Owner routes must use `requireOwnerAuth` middleware; guest routes must verify JWT + jti replay; RS256/JWKS must be active in prod (`OWNER_JWKS_URI` set)
4. **Audit log coverage**: `writeAudit()` called before AND after every sensitive operation (download, decrypt, submission create)
5. **Input validation**: All external input (guest forms, owner API params) validated through Zod schemas before use
6. **Secret hygiene**: No plaintext guest data in logs, error messages, or HTTP responses; no hardcoded keys

**Report format**: Group findings by severity — Critical / High / Medium — with file path and line number for each finding. Skip informational noise.
