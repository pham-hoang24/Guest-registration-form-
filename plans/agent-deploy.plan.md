# Deploy Agent

## Goal

Write a complete Azure deployment guide and IaC scripts (Azure CLI or Bicep) for deploying the guest registration platform to Azure Container Apps with Managed Identity, private networking, and least-privilege role assignments.

## Prerequisites

All of the following must be complete before deploying:
- `agent-db-adapter` — real SQL adapter wired
- `agent-storage-adapter` — Azure Blob Storage wired
- `agent-queue-adapter` — Azure Service Bus wired
- `agent-auth-oidc` — OIDC auth wired
- `agent-sql-schema` — schema.sql and rls.sql ready to apply

## Master plan reference

- [`production-readiness-master.plan.md`](production-readiness-master.plan.md)
- `infra/azure/README.md` — existing notes (extend, do not replace)

## Existing infra notes

Read `infra/azure/README.md` before starting. It covers core resources and role assignments at a high level. This agent makes it concrete and runnable.

## Tasks

### 1. Resource list and naming convention

Document or create the following Azure resources with consistent naming (e.g. `guestreg-{env}-{component}`):
- Resource Group: `rg-guestreg-{env}`
- Container Apps Environment: `cae-guestreg-{env}`
- Container App — API: `ca-guestreg-api-{env}`
- Container App — Worker: `ca-guestreg-worker-{env}`
- Azure SQL Server: `sql-guestreg-{env}`
- Azure SQL Database: `sqldb-guestreg-{env}`
- Storage Account: `stguestreg{env}` (max 24 chars, lowercase)
- Blob Container: `encrypted-pdfs`
- Service Bus Namespace: `sb-guestreg-{env}`
- Service Bus Queue: `submission-jobs`
- Key Vault: `kv-guestreg-{env}`
- Log Analytics Workspace: `log-guestreg-{env}`
- User-Assigned Managed Identity (API): `id-guestreg-api-{env}`
- User-Assigned Managed Identity (Worker): `id-guestreg-worker-{env}`

### 2. Managed Identity role assignments (least privilege)

| Identity | Resource | Role |
|---|---|---|
| API identity | Key Vault | Key Vault Crypto User (`wrapKey` only; unwrapKey not needed by API — only worker and owner download endpoint need it) |
| API + Worker identity | Key Vault | Key Vault Crypto User (`unwrapKey`) |
| Worker identity | Key Vault | Key Vault Crypto User (`wrapKey`, `unwrapKey`) |
| API identity | Blob Container | Storage Blob Data Reader (for owner download streaming) |
| Worker identity | Blob Container | Storage Blob Data Contributor (for writing encrypted blobs) |
| API identity | Service Bus Namespace | Azure Service Bus Data Sender |
| Worker identity | Service Bus Namespace | Azure Service Bus Data Receiver |
| API + Worker identity | SQL Database | db_datareader, db_datawriter (contained DB user, not sysadmin) |

Note: Both API and Worker unwrap DEKs. API unwraps for owner PDF download. Worker unwraps payload and wraps new PDF DEK. They can share one identity or use separate identities — document the choice.

### 3. Key Vault setup

```bash
az keyvault create \
  --name kv-guestreg-prod \
  --resource-group rg-guestreg-prod \
  --enable-soft-delete true \
  --enable-purge-protection true \
  --sku standard

# Create RSA-OAEP-256 KEK
az keyvault key create \
  --vault-name kv-guestreg-prod \
  --name guestreg-kek \
  --kty RSA \
  --size 2048 \
  --ops wrapKey unwrapKey
```

Capture and document:
- `KEYVAULT_URL` = `https://kv-guestreg-prod.vault.azure.net`
- `KEK_KEY_NAME` = `guestreg-kek`
- `KEK_KEY_VERSION` = (the version created above — pin to a specific version so rotation is explicit)

### 4. Azure SQL setup

```bash
az sql server create \
  --name sql-guestreg-prod \
  --resource-group rg-guestreg-prod \
  --location eastus \
  --enable-ad-only-auth \
  --external-admin-principal-type User \
  --external-admin-name admin@yourtenant.onmicrosoft.com \
  --external-admin-sid <admin-object-id>

az sql db create \
  --resource-group rg-guestreg-prod \
  --server sql-guestreg-prod \
  --name sqldb-guestreg-prod \
  --service-objective S1

# Disable public access; configure private endpoint
az sql server update \
  --name sql-guestreg-prod \
  --resource-group rg-guestreg-prod \
  --restrict-outbound-network-access true \
  --public-network-access Disabled
```

After creating, apply schema:
```bash
# Apply schema.sql and rls.sql via sqlcmd or Azure Data Studio
sqlcmd -S sql-guestreg-prod.database.windows.net -d sqldb-guestreg-prod -i backend/src/models/schema.sql
sqlcmd -S sql-guestreg-prod.database.windows.net -d sqldb-guestreg-prod -i backend/src/models/rls.sql
```

Create contained DB users for Managed Identities:
```sql
CREATE USER [id-guestreg-api-prod] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [id-guestreg-api-prod];
ALTER ROLE db_datawriter ADD MEMBER [id-guestreg-api-prod];

CREATE USER [id-guestreg-worker-prod] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [id-guestreg-worker-prod];
ALTER ROLE db_datawriter ADD MEMBER [id-guestreg-worker-prod];
```

### 5. Container App environment variables

**API Container App (`ca-guestreg-api-prod`):**
```
PORT=3000
NODE_ENV=production
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=20
GUEST_TOKEN_SECRET=<from Key Vault reference>
GUEST_TOKEN_AUD=guest-registration
OIDC_JWKS_URI=<identity provider JWKS endpoint>
OIDC_AUDIENCE=<app client id>
OIDC_ISSUER=<identity provider issuer>
KEYVAULT_URL=https://kv-guestreg-prod.vault.azure.net
KEK_KEY_NAME=guestreg-kek
KEK_KEY_VERSION=<pinned version>
SQL_SERVER=sql-guestreg-prod.database.windows.net
SQL_DATABASE=sqldb-guestreg-prod
BLOB_ACCOUNT_URL=https://stgueregreqprod.blob.core.windows.net
BLOB_CONTAINER=encrypted-pdfs
SERVICE_BUS_NAMESPACE=sb-guestreg-prod.servicebus.windows.net
SERVICE_BUS_QUEUE=submission-jobs
MAX_PDF_BYTES=10485760
```

**Worker Container App (`ca-guestreg-worker-prod`):**
Same env vars minus `OIDC_*` and `GUEST_TOKEN_*` (worker doesn't handle auth).
Add: `WORKER_MAX_ATTEMPTS=5`

**Secrets management:** Do not put `GUEST_TOKEN_SECRET` as plaintext. Use Key Vault reference syntax:
```
--secret "guest-token-secret=keyvaultref:https://kv-guestreg-prod.vault.azure.net/secrets/guest-token-secret,identityref:/subscriptions/.../id-guestreg-api-prod"
```

### 6. Container App deployment commands

```bash
# Create Container Apps Environment
az containerapp env create \
  --name cae-guestreg-prod \
  --resource-group rg-guestreg-prod \
  --location eastus \
  --logs-workspace-id <log-analytics-workspace-id> \
  --logs-workspace-key <log-analytics-key>

# Deploy API
az containerapp create \
  --name ca-guestreg-api-prod \
  --resource-group rg-guestreg-prod \
  --environment cae-guestreg-prod \
  --image <acr-name>.azurecr.io/guestreg-api:latest \
  --user-assigned <api-identity-resource-id> \
  --ingress external \
  --target-port 3000 \
  --min-replicas 1 \
  --max-replicas 5

# Deploy Worker (no external ingress)
az containerapp create \
  --name ca-guestreg-worker-prod \
  --resource-group rg-guestreg-prod \
  --environment cae-guestreg-prod \
  --image <acr-name>.azurecr.io/guestreg-worker:latest \
  --user-assigned <worker-identity-resource-id> \
  --ingress disabled \
  --min-replicas 1 \
  --max-replicas 3
```

### 7. Dockerfiles

Create `backend/Dockerfile.api`:
```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

Create `backend/Dockerfile.worker`:
```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
ENV NODE_ENV=production
CMD ["node", "dist/worker/index.js"]
```

### 8. Health check

The API already has `GET /healthz`. Configure Container Apps liveness probe:
```bash
az containerapp update \
  --name ca-guestreg-api-prod \
  --resource-group rg-guestreg-prod \
  --liveness-probe-path /healthz \
  --liveness-probe-port 3000 \
  --liveness-probe-protocol HTTP
```

### 9. Azure Front Door + WAF

```bash
az afd profile create \
  --profile-name afd-guestreg-prod \
  --resource-group rg-guestreg-prod \
  --sku Standard_AzureFrontDoor

# Add WAF policy
az network front-door waf-policy create \
  --name waf-guestreg-prod \
  --resource-group rg-guestreg-prod \
  --mode Prevention \
  --sku Standard_AzureFrontDoor
```

Document: WAF must block at minimum OWASP Core Rule Set 3.2. Rate limiting at WAF layer supplements (does not replace) the app-layer rate limiter.

### 10. Network: private endpoints

Document and script private endpoints for:
- Azure SQL → disable public access, add private endpoint in Container Apps VNET
- Key Vault → disable public access, add private endpoint
- Blob Storage → add private endpoint

For VNET integration, the Container Apps Environment must be deployed into a VNET:
```bash
az containerapp env create \
  --name cae-guestreg-prod \
  --infrastructure-subnet-resource-id /subscriptions/.../subnets/aca-subnet \
  ...
```

### 11. Update `infra/azure/README.md`

Extend (do not replace) with:
- Links to the script files created above
- Deployment checklist (ordered steps)
- Rollback procedure for failed deployments
- Key rotation procedure (reference `REWRAP_PROCEDURE.md`)

## Non-negotiable constraints

- No secrets in Docker images or env vars as plaintext. Use Key Vault references for all secrets.
- `--enable-purge-protection true` on Key Vault — cannot be disabled after creation.
- SQL Server must have `--enable-ad-only-auth` — no SQL auth passwords.
- Worker Container App must have `--ingress disabled` — not externally reachable.
- All role assignments use Managed Identity — no service principal client secrets.
- Container base image must be `node:22-alpine` or equivalent minimal image.

## Definition of done

- `infra/azure/` contains runnable deployment scripts (Azure CLI or Bicep) for all resources.
- `backend/Dockerfile.api` and `backend/Dockerfile.worker` build successfully.
- Env var table for API and Worker is complete and documents Key Vault reference syntax for secrets.
- Role assignment table is accurate and least-privilege.
- Private endpoint and WAF setup documented.
- `infra/azure/README.md` updated with ordered deployment checklist.
