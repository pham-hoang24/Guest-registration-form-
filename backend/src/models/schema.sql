-- ============================================================
-- Guest Registration Platform — Azure SQL Schema
-- ============================================================
-- Purpose:
--   Defines all tables, indexes, and constraints for the Guest
--   Registration Platform. Designed for Azure SQL Database.
--   All foreign keys use ON DELETE NO ACTION. Tenant isolation
--   is enforced at the application layer and reinforced by the
--   RLS policy in rls.sql.
--
-- Deployment order:
--   1. Run this file (schema.sql) to create all tables, indexes,
--      and constraints.
--   2. Run rls.sql to create the security schema, predicate
--      function, and security policy.
--
-- Conventions:
--   - All primary keys are UNIQUEIDENTIFIER (UUID).
--   - All timestamps use DATETIMEOFFSET to preserve time zone.
--   - audit_logs carries NO foreign keys so audit records survive
--     the deletion of tenants, properties, or submissions.
--   - encrypted_payloads.wrapped_dek is VARBINARY (raw binary),
--     not base64 NVARCHAR.
--   - encrypted_pdf_records.wrapped_dek_b64 is NVARCHAR(1024)
--     (base64 string).
-- ============================================================

-- ------------------------------------------------------------
-- tenants
-- ------------------------------------------------------------
CREATE TABLE dbo.tenants (
    id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_tenants PRIMARY KEY DEFAULT NEWID(),
    name       NVARCHAR(255)    NOT NULL,
    created_at DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

-- ------------------------------------------------------------
-- properties
-- ------------------------------------------------------------
CREATE TABLE dbo.properties (
    id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_properties PRIMARY KEY DEFAULT NEWID(),
    tenant_id   UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_properties_tenants REFERENCES dbo.tenants(id) ON DELETE NO ACTION,
    name        NVARCHAR(255)    NULL,
    address     NVARCHAR(512)    NULL,
    status      NVARCHAR(64)     NULL,
    rent        NVARCHAR(64)     NULL,
    lease_end   NVARCHAR(64)     NULL,
    floor_area  NVARCHAR(64)     NULL,
    inspection  NVARCHAR(64)     NULL,
    created_at  DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

-- ------------------------------------------------------------
-- users
-- ------------------------------------------------------------
CREATE TABLE dbo.users (
    id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_users PRIMARY KEY DEFAULT NEWID(),
    tenant_id   UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_users_tenants REFERENCES dbo.tenants(id) ON DELETE NO ACTION,
    external_id NVARCHAR(255)    NOT NULL,  -- OIDC sub claim
    created_at  DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT UQ_users_tenant_external UNIQUE (tenant_id, external_id)
);
GO

-- ------------------------------------------------------------
-- property_memberships
-- ------------------------------------------------------------
CREATE TABLE dbo.property_memberships (
    user_id     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_pm_users    REFERENCES dbo.users(id)      ON DELETE NO ACTION,
    property_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_pm_props    REFERENCES dbo.properties(id) ON DELETE NO ACTION,
    tenant_id   UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_pm_tenants  REFERENCES dbo.tenants(id)    ON DELETE NO ACTION,
    CONSTRAINT PK_property_memberships PRIMARY KEY (user_id, property_id)
);
GO

-- ------------------------------------------------------------
-- guest_token_jtis
-- ------------------------------------------------------------
CREATE TABLE dbo.guest_token_jtis (
    jti         NVARCHAR(128)    NOT NULL CONSTRAINT PK_guest_token_jtis PRIMARY KEY,
    tenant_id   UNIQUEIDENTIFIER NOT NULL,
    property_id UNIQUEIDENTIFIER NOT NULL,
    used_at     DATETIMEOFFSET   NOT NULL,
    expires_at  DATETIMEOFFSET   NOT NULL
);
GO

CREATE INDEX idx_guest_token_jtis_expires_at
    ON dbo.guest_token_jtis (expires_at);
GO

-- ------------------------------------------------------------
-- submissions
-- ------------------------------------------------------------
CREATE TABLE dbo.submissions (
    id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_submissions PRIMARY KEY,
    tenant_id      UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_submissions_tenants    REFERENCES dbo.tenants(id)    ON DELETE NO ACTION,
    property_id    UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_submissions_properties REFERENCES dbo.properties(id) ON DELETE NO ACTION,
    reservation_id NVARCHAR(255)    NULL,
    -- status values: PENDING_PDF | READY | FAILED
    status         NVARCHAR(32)     NOT NULL DEFAULT 'PENDING_PDF'
                       CONSTRAINT CK_submissions_status CHECK (status IN ('PENDING_PDF', 'READY', 'FAILED')),
    -- GDPR/data-governance notice: tenant_name is stored in plaintext.
    -- Anyone with SQL reader access (bypassing RLS via direct connection)
    -- can read guest names. Treat this column as PII under GDPR Art. 4.
    -- If your jurisdiction requires encryption at rest for names,
    -- remove this column and accept the cost of decrypting on list queries.
    tenant_name    NVARCHAR(255)    NULL,
    blob_path      NVARCHAR(1024)   NULL,
    aad_version    INT              NOT NULL DEFAULT 1,
    schema_version INT              NOT NULL DEFAULT 1,
    attempt_count  INT              NOT NULL DEFAULT 0,
    last_error     NVARCHAR(1024)   NULL,
    -- optimistic concurrency token; managed automatically by SQL Server
    row_version    ROWVERSION,
    created_at     DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updated_at     DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

-- Auto-update updated_at on every UPDATE.
-- The application must NOT manually set updated_at; let this trigger own it.
CREATE TRIGGER trg_submissions_updated_at
ON dbo.submissions
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.submissions
    SET updated_at = SYSDATETIMEOFFSET()
    FROM dbo.submissions s
    INNER JOIN inserted i ON s.id = i.id;
END;
GO

CREATE INDEX idx_submissions_tenant_id
    ON dbo.submissions (tenant_id);
GO

CREATE INDEX idx_submissions_tenant_property
    ON dbo.submissions (tenant_id, property_id);
GO

CREATE INDEX idx_submissions_status
    ON dbo.submissions (status);
GO

-- ------------------------------------------------------------
-- encrypted_pdf_records
-- ------------------------------------------------------------
CREATE TABLE dbo.encrypted_pdf_records (
    submission_id         UNIQUEIDENTIFIER NOT NULL
                              CONSTRAINT PK_encrypted_pdf_records PRIMARY KEY
                              CONSTRAINT FK_epr_submissions REFERENCES dbo.submissions(id) ON DELETE NO ACTION,
    tenant_id             UNIQUEIDENTIFIER NOT NULL,
    property_id           UNIQUEIDENTIFIER NOT NULL,
    record_version        INT              NOT NULL DEFAULT 1,
    crypto_version        NVARCHAR(32)     NOT NULL,
    aad_version           NVARCHAR(8)      NOT NULL,
    template_id           NVARCHAR(64)     NOT NULL,
    template_version      INT              NOT NULL,
    pdf_schema_version    NVARCHAR(32)     NOT NULL,
    blob_path             NVARCHAR(1024)   NOT NULL,
    content_type          NVARCHAR(128)    NOT NULL,
    content_length        INT              NOT NULL,
    nonce_b64             NVARCHAR(32)     NOT NULL,
    tag_b64               NVARCHAR(32)     NOT NULL,
    -- base64-encoded RSA-OAEP-256 wrapped DEK
    wrapped_dek_b64       NVARCHAR(1024)   NOT NULL,
    kek_key_id            NVARCHAR(512)    NOT NULL,
    kek_key_version       NVARCHAR(128)    NOT NULL,
    ciphertext_sha256_hex NCHAR(64)        NOT NULL,
    aad_sha256_hex        NCHAR(64)        NULL,
    status                NVARCHAR(32)     NOT NULL
                              CONSTRAINT CK_epr_status CHECK (status IN ('PENDING_PDF', 'READY', 'FAILED')),
    attempt_count         INT              NOT NULL DEFAULT 0,
    last_error            NVARCHAR(1024)   NULL,
    created_at            DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    -- optimistic concurrency token for compareAndSwap (rewrap job, retry logic)
    row_version           ROWVERSION
);
GO

CREATE INDEX idx_encrypted_pdf_records_tenant_id
    ON dbo.encrypted_pdf_records (tenant_id);
GO

CREATE INDEX idx_encrypted_pdf_records_kek
    ON dbo.encrypted_pdf_records (kek_key_id, kek_key_version);
GO

-- ------------------------------------------------------------
-- encrypted_payloads
-- NOTE: wrapped_dek is VARBINARY(1024) — raw binary, NOT base64.
-- NOTE: ciphertext is VARBINARY(MAX).
-- ------------------------------------------------------------
CREATE TABLE dbo.encrypted_payloads (
    submission_id         UNIQUEIDENTIFIER NOT NULL
                              CONSTRAINT PK_encrypted_payloads PRIMARY KEY
                              CONSTRAINT FK_ep_submissions REFERENCES dbo.submissions(id) ON DELETE NO ACTION,
    tenant_id             UNIQUEIDENTIFIER NOT NULL,
    property_id           UNIQUEIDENTIFIER NOT NULL,
    nonce                 VARBINARY(12)    NOT NULL,  -- AES-256-GCM nonce is exactly 12 bytes
    tag                   VARBINARY(16)    NOT NULL,
    ciphertext            VARBINARY(MAX)   NOT NULL,
    -- raw binary wrapped DEK (NOT base64 NVARCHAR)
    wrapped_dek           VARBINARY(1024)  NOT NULL,
    kek_key_id            NVARCHAR(512)    NOT NULL,
    kek_key_version       NVARCHAR(128)    NOT NULL,
    -- NVARCHAR(8) to match encrypted_pdf_records.aad_version (string constant e.g. "1")
    aad_version           NVARCHAR(8)      NOT NULL DEFAULT '1',
    schema_version        INT              NOT NULL DEFAULT 1,
    ciphertext_sha256_hex NCHAR(64)        NOT NULL
);
GO

CREATE INDEX idx_encrypted_payloads_tenant_id
    ON dbo.encrypted_payloads (tenant_id);
GO

-- ------------------------------------------------------------
-- audit_logs  (append-only — NEVER UPDATE or DELETE rows)
-- ------------------------------------------------------------
-- CRITICAL: tenant_id, property_id, and submission_id carry NO
-- foreign keys by design. Audit records must survive the deletion
-- of tenants, properties, and submissions.
-- ------------------------------------------------------------
CREATE TABLE dbo.audit_logs (
    id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_audit_logs PRIMARY KEY DEFAULT NEWID(),
    event_type     NVARCHAR(64)     NOT NULL,
    correlation_id NVARCHAR(128)    NOT NULL,
    actor_type     NVARCHAR(32)     NOT NULL,
    actor_id       NVARCHAR(255)    NOT NULL,
    -- NO FK: audit logs must survive tenant/submission deletion
    tenant_id      UNIQUEIDENTIFIER NULL,
    -- NO FK: audit logs must survive property deletion
    property_id    UNIQUEIDENTIFIER NULL,
    -- NO FK (critical constraint): audit logs must survive submission deletion
    submission_id  UNIQUEIDENTIFIER NULL,
    ip             NVARCHAR(64)     NULL,
    user_agent     NVARCHAR(512)    NULL,
    -- JSON blob of event-specific details
    details        NVARCHAR(MAX)    NULL,
    created_at     DATETIMEOFFSET   NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
GO

CREATE INDEX idx_audit_logs_submission_id
    ON dbo.audit_logs (submission_id);
GO

CREATE INDEX idx_audit_logs_tenant_created
    ON dbo.audit_logs (tenant_id, created_at);
GO

CREATE INDEX idx_audit_logs_event_created
    ON dbo.audit_logs (event_type, created_at);
GO
