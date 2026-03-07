-- ============================================================
-- Row Level Security (RLS) for tenant isolation
-- ============================================================
-- How it works:
--   The application calls sp_set_session_context(N'tenant_id', @tenantId, @read_only=1)
--   at the start of every request BEFORE any tenant-scoped query.
--   SESSION_CONTEXT is connection-scoped: it must be set on every
--   new connection / request. Do NOT assume it persists across requests.
--
-- Fail-closed design:
--   TRY_CAST is used instead of CAST. If SESSION_CONTEXT(N'tenant_id') is
--   NULL or holds a malformed non-UUID value (e.g. from a misconfigured test
--   tool), TRY_CAST returns NULL and the predicate returns 0 rows (deny),
--   rather than raising a conversion error and returning a 500.
--
-- FILTER vs BLOCK predicates:
--   FILTER: silently hides rows that don't match the session tenant on SELECT.
--   BLOCK AFTER INSERT: rejects INSERTs where the new row's tenant_id does not
--     match SESSION_CONTEXT — prevents cross-tenant writes from app bugs.
--   BLOCK AFTER UPDATE: rejects UPDATEs that would set tenant_id to a value
--     that doesn't match SESSION_CONTEXT.
--
-- Tables NOT covered by this policy (by design):
--   - guest_token_jtis: JTIs are globally unique strings; tenant isolation
--     is enforced in application code. No FK on tenant_id means RLS cannot
--     safely be applied without restructuring the table.
-- ============================================================

CREATE SCHEMA security;
GO

CREATE FUNCTION security.fn_tenant_predicate(@tenant_id UNIQUEIDENTIFIER)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
  SELECT 1 AS result
  WHERE TRY_CAST(SESSION_CONTEXT(N'tenant_id') AS UNIQUEIDENTIFIER) = @tenant_id;
GO

CREATE SECURITY POLICY tenant_isolation_policy
  -- submissions
  ADD FILTER PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.submissions,
  ADD BLOCK  PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.submissions AFTER INSERT,
  ADD BLOCK  PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.submissions AFTER UPDATE,
  -- encrypted_pdf_records
  ADD FILTER PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.encrypted_pdf_records,
  ADD BLOCK  PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.encrypted_pdf_records AFTER INSERT,
  ADD BLOCK  PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.encrypted_pdf_records AFTER UPDATE,
  -- encrypted_payloads
  ADD FILTER PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.encrypted_payloads,
  ADD BLOCK  PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.encrypted_payloads AFTER INSERT,
  ADD BLOCK  PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.encrypted_payloads AFTER UPDATE,
  -- audit_logs
  ADD FILTER PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.audit_logs,
  ADD BLOCK  PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.audit_logs AFTER INSERT,
  -- property_memberships
  ADD FILTER PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.property_memberships,
  ADD BLOCK  PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.property_memberships AFTER INSERT,
  ADD BLOCK  PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.property_memberships AFTER UPDATE,
  -- properties: covered by RLS so future workers/tools can't accidentally
  -- return cross-tenant rows even if they query properties directly.
  ADD FILTER PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.properties,
  ADD BLOCK  PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.properties AFTER INSERT,
  ADD BLOCK  PREDICATE security.fn_tenant_predicate(tenant_id) ON dbo.properties AFTER UPDATE
WITH (STATE = ON);
GO
