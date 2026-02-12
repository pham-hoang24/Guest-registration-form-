# Azure Deployment Notes (MVP)

## Core Resources
- Azure Container Apps: `api`, `worker`
- Azure Service Bus: queue for submission jobs + DLQ enabled
- Azure SQL Database with RLS
- Azure Blob Storage for encrypted PDFs
- Azure Key Vault for KEK wrap/unwrap (Managed Identity)
- Azure Front Door + WAF

## Managed Identity Permissions (least privilege)
- Key Vault: `get`, `wrapKey`, `unwrapKey` on KEK
- Blob Storage: `Storage Blob Data Contributor` on container
- Service Bus: `Azure Service Bus Data Sender` (API), `Azure Service Bus Data Receiver` (Worker)
- SQL: contained user with least-privilege role, RLS enforced

## Key Rotation / Rewrap
- Track `kek_key_id` + `kek_key_version` per submission.
- On rotation, run a rewrap job: unwrap old DEK with old key version, wrap with new key version, update row.

## App Settings (Env Vars)
### API
- `PORT`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX`
- `GUEST_TOKEN_SECRET`
- `GUEST_TOKEN_AUD`
- `OWNER_JWT_SECRET` (MVP; replace with OIDC/JWKS in production)
- `KEY_VAULT_KEY_ID`
- `KEY_VAULT_KEY_VERSION`
- `KEY_VAULT_WRAP_SECRET` (MVP stub; remove when wired to Key Vault)

### Worker
- `WORKER_MAX_ATTEMPTS`
- `KEY_VAULT_KEY_ID`
- `KEY_VAULT_KEY_VERSION`
- `KEY_VAULT_WRAP_SECRET`

## Security Notes
- No secrets in code; use Key Vault references for secrets.
- Enforce payload size limits and validation.
- Enable WAF and rate limiting on the public guest form endpoint.
- Use private endpoints for SQL, Blob, and Key Vault when possible.
