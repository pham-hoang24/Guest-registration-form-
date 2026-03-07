# Rewrap Job Agent

## Goal

Complete `backend/src/worker/rewrapDekJob.ts`. The per-record logic (`rewrapRecord`) is already correct. What's missing is the job orchestration: iterate all records by KEK, apply optimistic CAS, persist updates, and handle errors per record without stopping the batch.

## Prerequisites

- **`agent-db-adapter`** must be complete: `getEncryptedPdfRecordsByKek` and `compareAndSwapEncryptedPdfRecord` must be implemented on the real SQL adapter.

## Master plan reference

- [`production-readiness-master.plan.md`](production-readiness-master.plan.md)

## Existing code to read

- `backend/src/worker/rewrapDekJob.ts` — `rewrapRecord` is done; `rewrapDekJob` has 3 TODO comments
- `backend/src/services/db.ts` — `getEncryptedPdfRecordsByKek` (will be added by db-adapter agent)
- `backend/src/services/audit.ts` — `writeAudit`
- `backend/src/crypto/keyVaultKek.ts` — `KekAdapter` interface

## What `rewrapRecord` already does (do not change)

```typescript
// rewrapRecord(record, adapter, input):
// 1. Skip if already on new key version
// 2. Skip if record is on a different old key than expected
// 3. Unwrap DEK with old KEK
// 4. Wrap DEK with new KEK
// 5. Return updated record and changed=true
```

## Tasks

### 1. Replace `rewrapDekJob` body with real implementation

```typescript
export const rewrapDekJob = async (input: RewrapJobInput, adapter: KekAdapter) => {
  const correlationId = randomUUID();
  const pageSize = 100;
  let offset = 0;
  let totalProcessed = 0;
  let totalChanged = 0;
  let totalFailed = 0;

  while (true) {
    const page = await db.getEncryptedPdfRecordsByKek(
      input.oldKekKeyId,
      input.oldKekKeyVersion,
      { offset, limit: pageSize }
    );

    if (page.length === 0) break;

    for (const { record, version } of page) {
      try {
        const { record: updated, changed } = await rewrapRecord(record, adapter, input);

        if (!changed) {
          totalProcessed++;
          continue;
        }

        const swapped = await db.compareAndSwapEncryptedPdfRecord(
          record.submissionId,
          version,
          {
            wrappedDekB64: updated.wrappedDekB64,
            kekKeyId: updated.kekKeyId,
            kekKeyVersion: updated.kekKeyVersion
          }
        );

        if (swapped) {
          totalChanged++;
          writeAudit("dek_rewrapped", {
            correlationId,
            actorType: "system",
            actorId: "rewrap-job",
            tenantId: record.tenantId,
            submissionId: record.submissionId,
            details: {
              oldKekKeyId: input.oldKekKeyId,
              oldKekKeyVersion: input.oldKekKeyVersion ?? null,
              newKekKeyId: input.newKekKeyId,
              newKekKeyVersion: input.newKekKeyVersion ?? null
            }
          });
        } else {
          // CAS conflict: another process rewrapped this record concurrently — not an error
          writeAudit("dek_rewrapped", {
            correlationId,
            actorType: "system",
            actorId: "rewrap-job",
            tenantId: record.tenantId,
            submissionId: record.submissionId,
            details: { skipped: true, reason: "cas_conflict" }
          });
        }

        totalProcessed++;
      } catch (err) {
        totalFailed++;
        // Log per-record failure and continue — do not abort the batch
        writeAudit("keyvault_error", {
          correlationId,
          actorType: "system",
          actorId: "rewrap-job",
          submissionId: record.submissionId,
          tenantId: record.tenantId,
          details: { reason: (err as Error).message }
        });
      }
    }

    offset += pageSize;
  }

  return { totalProcessed, totalChanged, totalFailed };
};
```

### 2. Add types

`RewrapJobInput` already exists. Add a return type:
```typescript
export type RewrapJobResult = {
  totalProcessed: number;
  totalChanged: number;
  totalFailed: number;
};
```

### 3. Add an HTTP trigger or CLI entry point (optional but recommended)

Create `backend/src/worker/rewrapDekCmd.ts` as a runnable script:
```typescript
// Usage: node dist/worker/rewrapDekCmd.js --old-key-id <id> --old-key-version <v> --new-key-id <id> --new-key-version <v>
import { rewrapDekJob } from "./rewrapDekJob.js";
import { KeyVaultKekAdapter } from "../crypto/keyVaultKek.js";

const args = parseArgs(process.argv.slice(2));
const adapter = KeyVaultKekAdapter.fromEnv();
const result = await rewrapDekJob({
  oldKekKeyId: args["old-key-id"],
  oldKekKeyVersion: args["old-key-version"],
  newKekKeyId: args["new-key-id"],
  newKekKeyVersion: args["new-key-version"]
}, adapter);
console.log("Rewrap complete", result);
```

### 4. Document the rotation procedure

Add a short `REWRAP_PROCEDURE.md` in `backend/src/worker/`:
1. Create new key version in Key Vault (`az keyvault key create`).
2. Set `KEK_KEY_NAME` env var to same key name; Key Vault will use the latest version for new wraps automatically.
3. Run `rewrapDekCmd.ts` with old and new key IDs/versions.
4. Verify `totalFailed = 0`.
5. Once all records rewrapped, disable (do not delete) the old key version (soft-delete enabled).

## Non-negotiable constraints

- Per-record errors must NOT abort the batch. Log and continue.
- CAS conflicts are not errors — log as `skipped: cas_conflict` and continue.
- The job must be idempotent: re-running with the same `newKekKeyId/Version` skips already-rewrapped records (handled by `rewrapRecord` check).
- Do not log DEK bytes or wrapped DEK content.
- The rewrap job is a privileged system operation. It must only be triggerable by authenticated operators (CLI or admin API with explicit auth) — not exposed as a public endpoint.

## Definition of done

- `rewrapDekJob` iterates all matching records in pages, applies CAS, audits each result.
- Returns `{ totalProcessed, totalChanged, totalFailed }`.
- Per-record errors logged and batch continues.
- Idempotent: re-running skips already-rewrapped records.
- `rewrapDekCmd.ts` runnable as CLI.
