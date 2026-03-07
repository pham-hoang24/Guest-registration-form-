# DB Adapter Agent

## Goal

Replace `InMemoryDb` in `backend/src/services/db.ts` with a real Azure SQL adapter using the `mssql` package. Every tenant-scoped query must set `SESSION_CONTEXT(N'tenant_id')` before executing, so Azure SQL RLS is enforced at the DB layer.

## Prerequisites

- **`agent-sql-schema`** must be complete: `schema.sql` and `rls.sql` must exist and have been applied to the target database.

## Master plan reference

- [`production-readiness-master.plan.md`](production-readiness-master.plan.md)

## Existing code to keep

The current `InMemoryDb` must remain available for tests and local dev without a real DB. The adapter pattern must allow swapping. Do not delete `InMemoryDb`; move it or keep it alongside.

Existing files to read before starting:
- `backend/src/services/db.ts` — full InMemoryDb API; the SQL adapter must implement the same interface
- `backend/src/types.ts` — `SubmissionRecord`, `AuditLog`, `EncryptionMetadata`
- `backend/src/storage/encryptedPdfRecord.ts` — `EncryptedPdfRecord`
- `backend/src/services/payloadEncryption.ts` — `EncryptedPayloadRecord`
- `backend/src/services/payloadStore.ts` — `PayloadStore` interface

## Tasks

### 1. Extract a `DbAdapter` interface

In `backend/src/services/db.ts` (or a new `backend/src/services/dbInterface.ts`), extract a TypeScript interface covering all methods currently on `InMemoryDb`:

```typescript
export interface DbAdapter {
  createSubmission(input: Omit<SubmissionRecord, "createdAt" | "updatedAt">): Promise<SubmissionRecord>;
  updateSubmission(id: string, updates: Partial<SubmissionRecord>): Promise<SubmissionRecord | null>;
  getSubmission(id: string): Promise<SubmissionRecord | null>;
  getSubmissionWithVersion(id: string): Promise<{ submission: SubmissionRecord; version: number } | null>;
  compareAndSwapSubmission(id: string, expectedVersion: number, updates: Partial<SubmissionRecord>): Promise<SubmissionRecord | null>;
  setStatus(id: string, status: SubmissionStatus, lastError?: string | null): Promise<SubmissionRecord | null>;

  setEncryptedPdfRecord(record: EncryptedPdfRecord): Promise<void>;
  getEncryptedPdfRecord(submissionId: string): Promise<EncryptedPdfRecord | null>;
  getEncryptedPdfRecordWithVersion(submissionId: string): Promise<{ record: EncryptedPdfRecord; version: number } | null>;
  compareAndSwapEncryptedPdfRecord(submissionId: string, expectedVersion: number, updates: Partial<EncryptedPdfRecord>): Promise<EncryptedPdfRecord | null>;
  // Required by rewrap job:
  getEncryptedPdfRecordsByKek(kekKeyId: string, kekKeyVersion?: string, page: { offset: number; limit: number }): Promise<Array<{ record: EncryptedPdfRecord; version: number }>>;

  addAudit(event: Omit<AuditLog, "id" | "createdAt">): Promise<AuditLog>;

  markGuestTokenUsed(entry: GuestTokenJti): Promise<void>;
  getGuestTokenJti(jti: string): Promise<GuestTokenJti | null>;

  getOwnerIdentity(userId: string, tenantId: string): Promise<OwnerIdentity>;
  addMembership(membership: PropertyMembership): Promise<void>;

  insertPayload(tenantId: string, propertyId: string, submissionId: string, record: EncryptedPayloadRecord): Promise<void>;
  getPayload(tenantId: string, propertyId: string, submissionId: string): Promise<EncryptedPayloadRecord | null>;
}
```

Note: methods that were synchronous in `InMemoryDb` become `async` in the interface. Update all callers to `await`.

### 2. Install `mssql`

```bash
npm install mssql
npm install --save-dev @types/mssql
```

### 3. Implement `SqlDb` class

Create `backend/src/services/sqlDb.ts`. Key requirements:

**Connection pool:**
```typescript
import sql from "mssql";
import { DefaultAzureCredential } from "@azure/identity";

const config: sql.config = {
  server: process.env.SQL_SERVER!,
  database: process.env.SQL_DATABASE!,
  options: { encrypt: true, trustServerCertificate: false },
  authentication: {
    type: "azure-active-directory-default",  // Managed Identity
  },
  pool: { max: 10, min: 2, idleTimeoutMillis: 30000 }
};

let pool: sql.ConnectionPool | null = null;
export const getPool = async () => {
  if (!pool) pool = await new sql.ConnectionPool(config).connect();
  return pool;
};
```

**Tenant context helper — mandatory for all tenant-scoped queries:**
```typescript
const withTenantContext = async <T>(
  tenantId: string,
  fn: (request: sql.Request) => Promise<T>
): Promise<T> => {
  const p = await getPool();
  const txn = new sql.Transaction(p);
  await txn.begin();
  try {
    await new sql.Request(txn)
      .input("tenantId", sql.UniqueIdentifier, tenantId)
      .query("EXEC sp_set_session_context N'tenant_id', @tenantId");
    const result = await fn(new sql.Request(txn));
    await txn.commit();
    return result;
  } catch (e) {
    await txn.rollback();
    throw e;
  }
};
```

**`ROWVERSION` → version number:** Map `ROWVERSION` (returned as `Buffer` by mssql) to a comparable version number:
```typescript
const rowVersionToNumber = (buf: Buffer): number =>
  Number(buf.readBigUInt64BE(0));
```

**`compareAndSwap` pattern for submissions:** Use `WHERE id = @id AND row_version = @expectedVersion`. If 0 rows updated, return null (optimistic conflict). Example:
```typescript
async compareAndSwapSubmission(id, expectedVersion, updates) {
  return withTenantContext(updates.tenantId ?? await this.getTenantForSubmission(id), async (req) => {
    // Build SET clause from updates keys
    // WHERE id = @id AND CAST(row_version AS BIGINT) = @expectedVersion
    // IF @@ROWCOUNT = 0 return null
  });
}
```

**`getEncryptedPdfRecordsByKek`:** Used by rewrap job. Must support pagination via OFFSET/FETCH:
```typescript
SELECT * FROM encrypted_pdf_records
WHERE kek_key_id = @kekKeyId
  AND (@kekKeyVersion IS NULL OR kek_key_version = @kekKeyVersion)
ORDER BY submission_id
OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
```
Note: RLS will filter by tenant_id automatically — but the rewrap job is a system process that may need to iterate ALL tenants. The rewrap job must call this without tenant context (or with a privileged system connection that bypasses RLS — document the approach chosen).

**Audit log insert:** The `audit_logs` table is append-only. Implement `addAudit` as a simple INSERT. Never UPDATE or DELETE from `audit_logs`.

**`encrypted_payloads` binary columns:** `nonce`, `tag`, `ciphertext`, `wrapped_dek` are `VARBINARY` in SQL. Map `Buffer` ↔ `sql.VarBinary`.

### 4. Wire into `db.ts` export

Update `backend/src/services/db.ts` to export the right adapter based on environment:
```typescript
import { InMemoryDb } from "./inMemoryDb.js";
import { SqlDb } from "./sqlDb.js";
import type { DbAdapter } from "./dbInterface.js";

export const db: DbAdapter = process.env.SQL_CONNECTION_STRING
  ? new SqlDb()
  : new InMemoryDb();
```

Keep `InMemoryDb` importable directly for tests.

### 5. Update all callers to `await`

Since `InMemoryDb` methods were synchronous, every call site needs `await`. Affected files:
- `backend/src/routes/registration.ts`
- `backend/src/routes/owner.ts`
- `backend/src/services/authz.ts`
- `backend/src/services/audit.ts`
- `backend/src/services/guestToken.ts`
- `backend/src/worker/processSubmission.ts`
- `backend/src/worker/rewrapDekJob.ts`

Use a search to find all `db.` calls and add `await`.

### 6. Environment variables

Add to `backend/.env.example` (create if missing):
```
SQL_SERVER=your-server.database.windows.net
SQL_DATABASE=guestreg
# Leave blank to use InMemoryDb locally
SQL_CONNECTION_STRING=optional-legacy-flag
```

## Non-negotiable constraints

- `withTenantContext` must be called for every query against: `submissions`, `encrypted_pdf_records`, `encrypted_payloads`, `audit_logs`, `property_memberships`.
- `tenantId` passed to `withTenantContext` must always come from the verified JWT claim — never from user-controlled request body or query params.
- `encrypted_payloads.ciphertext` and `wrapped_dek` must use `sql.VarBinary` — not string.
- `audit_logs` inserts only — no UPDATE or DELETE.
- Connection pool must use Managed Identity auth (`azure-active-directory-default`) in production; local dev can use SQL auth via env override.

## Definition of done

- `SqlDb` implements every method in `DbAdapter`.
- All callers updated to `await` db methods.
- `InMemoryDb` still works for tests (existing test suite passes).
- `getEncryptedPdfRecordsByKek` implemented and paginated.
- `withTenantContext` wraps every tenant-scoped query.
- `process.env.SQL_SERVER` unset → falls back to `InMemoryDb` (local dev works without SQL).
