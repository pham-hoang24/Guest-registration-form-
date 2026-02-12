-- Core tenant tables
CREATE TABLE tenants (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  name NVARCHAR(200) NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE properties (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  name NVARCHAR(200) NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_properties_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE users (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  external_subject NVARCHAR(200) NOT NULL,
  display_name NVARCHAR(200) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE property_memberships (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  property_id UNIQUEIDENTIFIER NOT NULL,
  user_id UNIQUEIDENTIFIER NOT NULL,
  role NVARCHAR(50) NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_memberships_property FOREIGN KEY (property_id) REFERENCES properties(id),
  CONSTRAINT fk_memberships_user FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Retention policies
CREATE TABLE retention_policies (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  property_id UNIQUEIDENTIFIER NULL,
  retention_days INT NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_retention_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_retention_property FOREIGN KEY (property_id) REFERENCES properties(id)
);

-- Submission metadata (no PII plaintext)
CREATE TABLE submissions (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  property_id UNIQUEIDENTIFIER NOT NULL,
  reservation_id NVARCHAR(100) NULL,
  status NVARCHAR(20) NOT NULL,
  blob_path NVARCHAR(500) NULL,
  wrapped_dek NVARCHAR(2000) NULL,
  kek_key_id NVARCHAR(200) NULL,
  kek_key_version NVARCHAR(100) NULL,
  content_hash CHAR(64) NULL,
  aad_version INT NOT NULL DEFAULT 1,
  schema_version INT NOT NULL DEFAULT 1,
  attempt_count INT NOT NULL DEFAULT 0,
  last_error NVARCHAR(1000) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_submissions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_submissions_property FOREIGN KEY (property_id) REFERENCES properties(id)
);

-- Optional encrypted raw payload storage (per-submission DEK + KEK; AAD with purpose "payload")
CREATE TABLE submission_payloads (
  submission_id UNIQUEIDENTIFIER PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  property_id UNIQUEIDENTIFIER NOT NULL,
  payload_ciphertext VARBINARY(MAX) NOT NULL,
  nonce VARBINARY(12) NOT NULL,
  tag VARBINARY(16) NOT NULL,
  wrapped_dek VARBINARY(500) NOT NULL,
  kek_key_id NVARCHAR(200) NOT NULL,
  kek_key_version NVARCHAR(100) NOT NULL,
  aad_version INT NOT NULL DEFAULT 1,
  schema_version INT NOT NULL DEFAULT 1,
  ciphertext_sha256 CHAR(64) NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_payload_submission FOREIGN KEY (submission_id) REFERENCES submissions(id)
);

-- Encryption metadata for blobs
CREATE TABLE encryption_metadata (
  submission_id UNIQUEIDENTIFIER PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  property_id UNIQUEIDENTIFIER NOT NULL,
  algo NVARCHAR(50) NOT NULL,
  nonce VARBINARY(64) NOT NULL,
  tag VARBINARY(64) NOT NULL,
  ciphertext_sha256 CHAR(64) NOT NULL,
  content_type NVARCHAR(100) NOT NULL,
  content_length BIGINT NOT NULL,
  aad_version INT NOT NULL,
  schema_version INT NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_metadata_submission FOREIGN KEY (submission_id) REFERENCES submissions(id)
);

-- Guest token replay protection
CREATE TABLE guest_token_jtis (
  jti NVARCHAR(200) PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  property_id UNIQUEIDENTIFIER NOT NULL,
  used_at DATETIME2 NOT NULL,
  expires_at DATETIME2 NOT NULL
);

-- Audit logs (minimal row + optional JSON details)
CREATE TABLE audit_logs (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  event_type NVARCHAR(100) NOT NULL,
  correlation_id NVARCHAR(100) NOT NULL,
  actor_type NVARCHAR(20) NOT NULL,
  actor_id NVARCHAR(200) NOT NULL,
  tenant_id UNIQUEIDENTIFIER NULL,
  property_id UNIQUEIDENTIFIER NULL,
  submission_id UNIQUEIDENTIFIER NULL,
  ip NVARCHAR(64) NULL,
  user_agent NVARCHAR(500) NULL,
  details NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

-- Indexes
CREATE INDEX ix_properties_tenant ON properties(tenant_id);
CREATE INDEX ix_users_tenant ON users(tenant_id);
CREATE INDEX ix_memberships_user ON property_memberships(user_id);
CREATE INDEX ix_memberships_property ON property_memberships(property_id);
CREATE INDEX ix_submissions_tenant ON submissions(tenant_id);
CREATE INDEX ix_submissions_property ON submissions(property_id);
CREATE INDEX ix_submissions_status ON submissions(status);
CREATE INDEX ix_audit_tenant_time ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX ix_audit_submission ON audit_logs(submission_id, created_at DESC);
CREATE INDEX ix_guest_token_jti_exp ON guest_token_jtis(expires_at);
