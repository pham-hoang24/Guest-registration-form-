# DEK Rewrap Procedure

Runbook for rotating the Key Encryption Key (KEK) that wraps all per-submission
Data Encryption Keys (DEKs).

> **Security note**: This is a privileged system operation. Only authenticated
> operators with access to the deployment environment (managed identity, CI/CD
> pipeline, or Azure CLI with RBAC) should perform these steps.

---

## Prerequisites

- Azure CLI authenticated with an identity that has **Key Vault Crypto Officer** role.
- `KEYVAULT_URL` and `KEK_KEY_NAME` environment variables set.
- Backend built: `npm run build` (output in `dist/`).
- Database and Key Vault reachable from the machine running the job.

> **Concurrency warning**: Do NOT run two instances of this job simultaneously
> with the same arguments. Concurrent runs produce split audit trails (two
> `phase: completed` events with different counts) and split `totalChanged` /
> `totalFailed` metrics that do not add up to the true totals. Each record
> is protected by optimistic CAS so data integrity is maintained, but operator
> visibility is degraded. If concurrent execution is possible in your environment
> (e.g. CI/CD pipeline retry), acquire an advisory lock (Azure Blob lease,
> Azure Cache for Redis SETNX, or a database-level lock) before running.

---

## Rotation Steps

### 1. Create a new key version in Key Vault

```bash
az keyvault key create \
  --vault-name <vault-name> \
  --name <key-name> \
  --kty RSA \
  --size 4096 \
  --ops wrapKey unwrapKey
```

Note the **version** printed in the output (hex string under `kid`).

### 2. Capture old and new key metadata

```bash
# List versions; the first two are new and old
az keyvault key list-versions \
  --vault-name <vault-name> \
  --name <key-name> \
  --query "[].{id:kid, enabled:attributes.enabled, created:attributes.created}" \
  --output table
```

Export the full key IDs (URI form) as shell variables:

```bash
export OLD_KEY_ID="https://<vault>.vault.azure.net/keys/<name>/<old-version>"
export OLD_KEY_VERSION="<old-version>"
export NEW_KEY_ID="https://<vault>.vault.azure.net/keys/<name>/<new-version>"
export NEW_KEY_VERSION="<new-version>"
```

### 3. Dry-run (optional sanity check)

```bash
node dist/worker/rewrapDekCmd.js \
  --old-key-id   "$OLD_KEY_ID" \
  --old-key-version "$OLD_KEY_VERSION" \
  --new-key-id   "$NEW_KEY_ID" \
  --new-key-version "$NEW_KEY_VERSION" \
  --dry-run
```

### 4. Run the rewrap job

```bash
node dist/worker/rewrapDekCmd.js \
  --old-key-id   "$OLD_KEY_ID" \
  --old-key-version "$OLD_KEY_VERSION" \
  --new-key-id   "$NEW_KEY_ID" \
  --new-key-version "$NEW_KEY_VERSION"
```

The job exits with code **0** when `totalFailed === 0`, or **1** if any
records failed (inspect the audit log for `keyvault_error` events with the
printed `correlationId`).

### 5. Verify completion

Check the output for:
```
{ totalProcessed: N, totalChanged: N, totalFailed: 0 }
```

Query the audit log for any `keyvault_error` events associated with the job's
`correlationId` and resolve each failure individually before proceeding.

### 6. Re-run if needed

The job is **idempotent**: records already on the new key are skipped. Re-run
with the same arguments to pick up any records that failed on the first pass.

### 7. Disable (do NOT delete) the old key version

Once `totalFailed === 0` and all records are on the new key:

```bash
az keyvault key set-attributes \
  --vault-name <vault-name> \
  --name <key-name> \
  --version "$OLD_KEY_VERSION" \
  --enabled false
```

> **Do not delete** the old key version. Azure Key Vault's soft-delete ensures
> it can be recovered if any records are discovered that still reference it.
> Deleting it would make those records permanently unreadable.

---

## Rollback

If the new key version must be abandoned before rotation completes:

1. Re-enable the old key version if it was disabled.
2. Run the job in reverse (swap old/new arguments) to rewrap back onto the old key.

---

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| `totalFailed > 0` | Key Vault throttling or transient error | Re-run job (idempotent) |
| Job hangs on first page | DB unreachable | Check SQL_SERVER env var and network |
| `Missing required arguments` | CLI args not provided | See usage in step 4 |
| `KEYVAULT_URL and KEK_KEY_NAME must be set` | Env vars missing | Export before running |
