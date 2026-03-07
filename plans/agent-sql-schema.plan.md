# SQL Schema Agent

## Goal

Write `backend/src/models/schema.sql` and replace the placeholder `backend/src/models/rls.sql` with a complete, production-ready Azure SQL schema and Row Level Security policy. No TypeScript code. Pure SQL only.

## Prerequisites

None. This agent runs first and unblocks `agent-db-adapter`.

## Master plan reference

- [`production-readiness-master.plan.md`](production-readiness-master.plan.md)

## Context — what the TypeScript types tell you

The existing TypeScript types define exactly what columns are needed. Read these files before writing SQL:
- `backend/src/types.ts` — `SubmissionRecord`, `EncryptionMetadata`, `AuditLog`, `AuditEventType`
- `backend/src/storage/encryptedPdfRecord.ts` — `EncryptedPdfRecord`
- `backend/src/services/payloadEncryption.ts` — `EncryptedPayloadRecord`
- `backend/src/services/db.ts` — `GuestTokenJti`, `PropertyMembership` (internal types)

## Tasks

### 1. Write `backend/src/models/schema.sql`

Create a complete Azure SQL schema. Requirements:

**Tables required (with key columns):**

`tenants`
- `id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID()`
- `name NVARCHAR(255) NOT NULL`
- `created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()`

`properties`
- `id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID()`
- `tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id)`
- `name NVARCHAR(255) NULL`
- `address NVARCHAR(512) NULL`
- `status NVARCHAR(64) NULL`
- `rent NVARCHAR(64) NULL`
- `lease_end NVARCHAR(64) NULL`
- `floor_area NVARCHAR(64) NULL`
- `inspection NVARCHAR(64) NULL`
- `created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()`

`users`
- `id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID()`
- `tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id)`
- `external_id NVARCHAR(255) NOT NULL` (OIDC sub claim)
- `created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()`
- `UNIQUE (tenant_id, external_id)`

`property_memberships`
- `user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id)`
- `property_id UNIQUEIDENTIFIER NOT NULL REFERENCES properties(id)`
- `tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id)`
- `PRIMARY KEY (user_id, property_id)`

`guest_token_jtis`
- `jti NVARCHAR(128) PRIMARY KEY`
- `tenant_id UNIQUEIDENTIFIER NOT NULL`
- `property_id UNIQUEIDENTIFIER NOT NULL`
- `used_at DATETIMEOFFSET NOT NULL`
- `expires_at DATETIMEOFFSET NOT NULL`
- Index on `expires_at` for cleanup jobs

`submissions`
- `id UNIQUEIDENTIFIER PRIMARY KEY`
- `tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id)`
- `property_id UNIQUEIDENTIFIER NOT NULL REFERENCES properties(id)`
- `reservation_id NVARCHAR(255) NULL`
- `status NVARCHAR(32) NOT NULL DEFAULT 'PENDING_PDF'` — values: PENDING_PDF, READY, FAILED
- `tenant_name NVARCHAR(255) NULL` — **Unencrypted display name from guest payload, populated on insert. Required for list endpoint without decrypting payload.**
- `blob_path NVARCHAR(1024) NULL`
- `aad_version INT NOT NULL DEFAULT 1`
- `schema_version INT NOT NULL DEFAULT 1`
- `attempt_count INT NOT NULL DEFAULT 0`
- `last_error NVARCHAR(1024) NULL`
- `row_version ROWVERSION` — optimistic concurrency (maps to TypeScript version field)
- `created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()`
- `updated_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()`
- Indexes: `(tenant_id)`, `(tenant_id, property_id)`, `(status)` for worker queue polling

`encrypted_pdf_records`
- `submission_id UNIQUEIDENTIFIER PRIMARY KEY REFERENCES submissions(id)`
- `tenant_id UNIQUEIDENTIFIER NOT NULL`
- `property_id UNIQUEIDENTIFIER NOT NULL`
- `record_version INT NOT NULL DEFAULT 1`
- `crypto_version NVARCHAR(32) NOT NULL` — e.g. "AES-256-GCM"
- `aad_version NVARCHAR(8) NOT NULL` — e.g. "1"
- `template_id NVARCHAR(64) NOT NULL`
- `template_version INT NOT NULL`
- `pdf_schema_version NVARCHAR(32) NOT NULL`
- `blob_path NVARCHAR(1024) NOT NULL`
- `content_type NVARCHAR(128) NOT NULL`
- `content_length INT NOT NULL`
- `nonce_b64 NVARCHAR(32) NOT NULL` — base64(12 bytes) = 16 chars
- `tag_b64 NVARCHAR(32) NOT NULL` — base64(16 bytes) = 24 chars
- `wrapped_dek_b64 NVARCHAR(1024) NOT NULL`
- `kek_key_id NVARCHAR(512) NOT NULL`
- `kek_key_version NVARCHAR(128) NOT NULL`
- `ciphertext_sha256_hex NCHAR(64) NOT NULL`
- `aad_sha256_hex NCHAR(64) NULL`
- `status NVARCHAR(32) NOT NULL`
- `attempt_count INT NOT NULL DEFAULT 0`
- `last_error NVARCHAR(1024) NULL`
- `created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()`
- Index on `(kek_key_id, kek_key_version)` — required for rewrap job to find records by KEK

`encrypted_payloads`
- `submission_id UNIQUEIDENTIFIER PRIMARY KEY REFERENCES submissions(id)`
- `tenant_id UNIQUEIDENTIFIER NOT NULL`
- `property_id UNIQUEIDENTIFIER NOT NULL`
- `nonce VARBINARY(16) NOT NULL`
- `tag VARBINARY(16) NOT NULL`
- `ciphertext VARBINARY(MAX) NOT NULL`
- `wrapped_dek VARBINARY(1024) NOT NULL`
- `kek_key_id NVARCHAR(512) NOT NULL`
- `kek_key_version NVARCHAR(128) NOT NULL`
- `aad_version INT NOT NULL DEFAULT 1`
- `schema_version INT NOT NULL DEFAULT 1`
- `ciphertext_sha256_hex NCHAR(64) NOT NULL`

`audit_logs` — **append-only, never UPDATE or DELETE**
- `id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID()`
- `event_type NVARCHAR(64) NOT NULL`
- `correlation_id NVARCHAR(128) NOT NULL`
- `actor_type NVARCHAR(32) NOT NULL`
- `actor_id NVARCHAR(255) NOT NULL`
- `tenant_id UNIQUEIDENTIFIER NULL`
- `property_id UNIQUEIDENTIFIER NULL`
- `submission_id UNIQUEIDENTIFIER NULL`
- `ip NVARCHAR(64) NULL`
- `user_agent NVARCHAR(512) NULL`
- `details NVARCHAR(MAX) NULL` — JSON blob
- `created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()`
- Indexes: `(submission_id)`, `(tenant_id, created_at)`, `(event_type, created_at)` for audit queries

**Important notes for all tables:**
- All foreign key references use `ON DELETE NO ACTION` (explicit, not default). Never cascade delete submissions or audit logs.
- Do not add columns not present in the TypeScript types without a clear reason.
- Each `CREATE INDEX` should be named explicitly (e.g. `idx_submissions_tenant_id`).

### 2. Replace `backend/src/models/rls.sql`

The current file is a placeholder. Replace it with a real Azure SQL RLS implementation:

```sql
-- Step 1: Schema for security objects
CREATE SCHEMA security;
GO

-- Step 2: Predicate function
-- SESSION_CONTEXT key: N'tenant_id' (set by app per request via sp_set_session_context)
-- The function returns 1 (allow) only when the row's tenant_id matches the session context.
-- NULL session context = deny all (fail-closed).
CREATE FUNCTION security.fn_tenant_predicate(@tenant_id UNIQUEIDENTIFIER)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
  SELECT 1 AS result
  WHERE CAST(SESSION_CONTEXT(N'tenant_id') AS UNIQUEIDENTIFIER) = @tenant_id;
GO

-- Step 3: Security policy — FILTER predicate on all tenant-scoped tables
-- FILTER: silently filters rows (SELECT returns 0 rows rather than error).
-- BLOCK: prevents INSERT/UPDATE with wrong tenant (add if needed).
CREATE SECURITY POLICY tenant_isolation_policy
  ADD FILTER PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.submissions,
  ADD FILTER PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.encrypted_pdf_records,
  ADD FILTER PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.encrypted_payloads,
  ADD FILTER PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.audit_logs,
  ADD FILTER PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.property_memberships
WITH (STATE = ON);
GO
```

**Add a comment block** explaining:
- How the app must call `sp_set_session_context` before any tenant-scoped query.
- That `SESSION_CONTEXT` is connection-scoped, so it must be set at the start of every request/transaction.
- That `guest_token_jtis` and `properties` are NOT in the policy by design (explain why: jtis are global unique, properties are looked up by membership check in app layer).

### 3. Add a `db-setup.md` note

Create `backend/src/models/db-setup.md` with three steps:
1. Run `schema.sql`
2. Run `rls.sql`
3. App environment variable `SQL_CONNECTION_STRING` format for Azure SQL with Managed Identity (`Authentication=Active Directory Managed Identity`)

## Non-negotiable constraints

- `audit_logs` must have no FK on `submission_id` — submissions can be deleted for retention but audit logs must remain.
- `encrypted_payloads.ciphertext` is `VARBINARY(MAX)` — never `NVARCHAR`.
- Do not store wrapped DEK as NVARCHAR — use `VARBINARY(1024)` for `encrypted_payloads.wrapped_dek` (binary). The `encrypted_pdf_records.wrapped_dek_b64` is base64 string stored as `NVARCHAR` — this distinction must be consistent between the two tables.
- RLS predicate function must use `WITH SCHEMABINDING`.
- Security policy must be created with `STATE = ON`.

## Definition of done

- `backend/src/models/schema.sql` creates all tables, indexes, and constraints without errors on Azure SQL.
- `backend/src/models/rls.sql` creates the predicate function and security policy; a cross-tenant SELECT on `submissions` with a mismatched `SESSION_CONTEXT` returns 0 rows.
- `backend/src/models/db-setup.md` documents the run order and connection string format.
