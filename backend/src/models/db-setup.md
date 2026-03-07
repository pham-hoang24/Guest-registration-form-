# Database Setup

## 1. Run `schema.sql`

Execute `schema.sql` against your Azure SQL Database to create all tables, indexes, and constraints. This must be run first.

```sql
-- Example using sqlcmd:
sqlcmd -S <server>.database.windows.net -d <db> -G -i backend/src/models/schema.sql
```

Tables created:
- `tenants`
- `properties`
- `users`
- `property_memberships`
- `guest_token_jtis`
- `submissions`
- `encrypted_pdf_records`
- `encrypted_payloads`
- `audit_logs`

## 2. Run `rls.sql`

After all tables exist, execute `rls.sql` to create the `security` schema, the tenant predicate function, and the security policy that enforces row-level tenant isolation.

```sql
sqlcmd -S <server>.database.windows.net -d <db> -G -i backend/src/models/rls.sql
```

This creates:
- `security` schema
- `security.fn_tenant_predicate` — inline table-valued function (WITH SCHEMABINDING)
- `tenant_isolation_policy` — filter predicates on `submissions`, `encrypted_pdf_records`, `encrypted_payloads`, `audit_logs`, and `property_memberships`

## 3. Application Connection String

```
Server=<server>.database.windows.net;Database=<db>;Authentication=Active Directory Managed Identity
```

Managed Identity requires the application's managed identity to be granted database access. After enabling a system-assigned (or user-assigned) managed identity on the Azure resource (e.g. Container App), run the following in the target database:

```sql
CREATE USER [<identity-name>] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [<identity-name>];
ALTER ROLE db_datawriter ADD MEMBER [<identity-name>];
```

Replace `<identity-name>` with the display name of the managed identity as it appears in Azure Active Directory. You can also grant access via the Azure portal under the SQL Database's Azure Active Directory admin blade.

## 4. Audit Log Role — INSERT-Only Enforcement

`audit_logs` is append-only by design, but `db_datawriter` grants DELETE too. Create a dedicated role and grant only INSERT:

```sql
CREATE ROLE audit_writer;
GRANT INSERT ON dbo.audit_logs TO audit_writer;
-- Explicitly deny DELETE and UPDATE so any future GRANT to db_datawriter cannot override
DENY UPDATE ON dbo.audit_logs TO audit_writer;
DENY DELETE ON dbo.audit_logs TO audit_writer;

ALTER ROLE audit_writer ADD MEMBER [<identity-name>];
```

If your application identity already has `db_datawriter`, you still need the explicit DENY:

```sql
DENY DELETE ON dbo.audit_logs TO [<identity-name>];
DENY UPDATE ON dbo.audit_logs TO [<identity-name>];
```

## 5. Session Context — Mandatory Before Every Tenant Query

The RLS policy relies on `SESSION_CONTEXT(N'tenant_id')` being set on every connection before any tenant-scoped query is executed. The application must call:

```sql
EXEC sp_set_session_context N'tenant_id', @tenantId, @read_only = 1;
```

- `@tenantId` must be the `UNIQUEIDENTIFIER` value for the authenticated tenant.
- `@read_only = 1` prevents the application from overwriting the context later in the same connection, which guards against privilege-escalation bugs.
- SESSION_CONTEXT is connection-scoped and does NOT persist across connections or requests. It must be set on every new connection from the pool.

Failure to set the context before querying will result in 0 rows being returned for all RLS-protected tables (fail-closed behaviour).
