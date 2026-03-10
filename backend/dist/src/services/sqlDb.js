/**
 * SqlDb — Azure SQL adapter implementing DbAdapter.
 *
 * Tenant isolation: every query against tenant-scoped tables
 * (submissions, encrypted_pdf_records, encrypted_payloads,
 * audit_logs, property_memberships) MUST call withTenantContext()
 * to set SESSION_CONTEXT(N'tenant_id') before executing, enabling
 * the Azure SQL RLS predicate in rls.sql.
 *
 * The tenantId passed to withTenantContext MUST come from the
 * verified JWT claim — never from user-controlled request data.
 *
 * getEncryptedPdfRecordsByKek is intentionally exempt from
 * withTenantContext: it is a system-only operation (rewrap job)
 * that must iterate ALL tenants. In production this method must
 * use a DB connection identity that is EXEMPT from the RLS policy
 * (e.g. db_owner or a dedicated service account with RLS bypass),
 * or the policy must include an exemption predicate for this role.
 */
import sql from "mssql";
import { randomUUID } from "node:crypto";
// ---------------------------------------------------------------------------
// Connection pool
// ---------------------------------------------------------------------------
const buildConfig = () => ({
    server: process.env.SQL_SERVER,
    database: process.env.SQL_DATABASE,
    options: { encrypt: true, trustServerCertificate: false },
    authentication: {
        type: "azure-active-directory-default",
        options: {}
    },
    pool: { max: 10, min: 2, idleTimeoutMillis: 30_000 }
});
// Store the promise, not the resolved pool, so concurrent callers wait on the
// same connection attempt rather than spawning multiple pools.
let _poolPromise = null;
const getPool = () => {
    if (!_poolPromise) {
        _poolPromise = new sql.ConnectionPool(buildConfig()).connect();
    }
    return _poolPromise;
};
// ---------------------------------------------------------------------------
// ROWVERSION → comparable version number
// ---------------------------------------------------------------------------
const rowVersionToNumber = (buf) => Number(buf.readBigUInt64BE(0));
// ---------------------------------------------------------------------------
// Tenant context helper
// Every tenant-scoped query MUST go through this wrapper.
// ---------------------------------------------------------------------------
const withTenantContext = async (tenantId, fn) => {
    const p = await getPool();
    const txn = new sql.Transaction(p);
    await txn.begin();
    try {
        await new sql.Request(txn)
            .input("tenantId", sql.UniqueIdentifier, tenantId)
            // read_only = 1 prevents any subsequent code in this connection from
            // overwriting the tenant context mid-transaction (fail-secure default).
            .query("EXEC sp_set_session_context N'tenant_id', @tenantId, 1");
        const result = await fn(new sql.Request(txn));
        await txn.commit();
        return result;
    }
    catch (e) {
        await txn.rollback();
        throw e;
    }
};
const mapSubmission = (row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    propertyId: row.property_id,
    reservationId: row.reservation_id,
    status: row.status,
    tenantName: row.tenant_name,
    blobPath: row.blob_path,
    aadVersion: row.aad_version,
    schemaVersion: row.schema_version,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    rowVersion: row.row_version.toString("hex"),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
});
const mapEncryptedPdfRecord = (row) => ({
    submissionId: row.submission_id,
    tenantId: row.tenant_id,
    propertyId: row.property_id,
    recordVersion: row.record_version,
    cryptoVersion: row.crypto_version,
    aadVersion: row.aad_version,
    templateId: row.template_id,
    templateVersion: row.template_version,
    pdfSchemaVersion: row.pdf_schema_version,
    blobPath: row.blob_path,
    contentType: row.content_type,
    contentLength: row.content_length,
    nonceB64: row.nonce_b64,
    tagB64: row.tag_b64,
    wrappedDekB64: row.wrapped_dek_b64,
    kekKeyId: row.kek_key_id,
    kekKeyVersion: row.kek_key_version,
    ciphertextSha256Hex: row.ciphertext_sha256_hex,
    aadSha256Hex: row.aad_sha256_hex ?? undefined,
    status: row.status,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    createdAt: row.created_at.toISOString()
});
const mapEncryptedPayload = (row) => ({
    nonce: row.nonce,
    tag: row.tag,
    ciphertext: row.ciphertext,
    wrappedDek: row.wrapped_dek,
    kekKeyId: row.kek_key_id,
    kekKeyVersion: row.kek_key_version,
    aadVersion: Number(row.aad_version),
    schemaVersion: row.schema_version,
    ciphertextSha256Hex: row.ciphertext_sha256_hex
});
// ---------------------------------------------------------------------------
// SqlDb
// ---------------------------------------------------------------------------
export class SqlDb {
    // -------------------------------------------------------------------------
    // Submissions
    // -------------------------------------------------------------------------
    async createSubmission(input) {
        return withTenantContext(input.tenantId, async (req) => {
            req
                .input("id", sql.UniqueIdentifier, input.id)
                .input("tenantId", sql.UniqueIdentifier, input.tenantId)
                .input("propertyId", sql.UniqueIdentifier, input.propertyId)
                .input("reservationId", sql.NVarChar(255), input.reservationId ?? null)
                .input("status", sql.NVarChar(32), input.status)
                .input("tenantName", sql.NVarChar(255), input.tenantName ?? null)
                .input("blobPath", sql.NVarChar(1024), input.blobPath ?? null)
                .input("aadVersion", sql.Int, input.aadVersion)
                .input("schemaVersion", sql.Int, input.schemaVersion)
                .input("attemptCount", sql.Int, input.attemptCount)
                .input("lastError", sql.NVarChar(sql.MAX), input.lastError ?? null);
            const result = await req.query(`
        INSERT INTO dbo.submissions
          (id, tenant_id, property_id, reservation_id, status, tenant_name,
           blob_path, aad_version, schema_version, attempt_count, last_error)
        OUTPUT
          inserted.id, inserted.tenant_id, inserted.property_id,
          inserted.reservation_id, inserted.status, inserted.tenant_name,
          inserted.blob_path, inserted.aad_version, inserted.schema_version,
          inserted.attempt_count, inserted.last_error, inserted.row_version,
          inserted.created_at, inserted.updated_at
        VALUES
          (@id, @tenantId, @propertyId, @reservationId, @status, @tenantName,
           @blobPath, @aadVersion, @schemaVersion, @attemptCount, @lastError)
      `);
            return mapSubmission(result.recordset[0]);
        });
    }
    async updateSubmission(id, updates) {
        const tenantId = updates.tenantId ?? await this.getTenantIdForSubmission(id);
        if (!tenantId)
            return null;
        return withTenantContext(tenantId, async (req) => {
            // Always update updated_at explicitly so OUTPUT reflects the new value
            // (the trigger also updates it, but OUTPUT captures state before triggers run).
            const setClauses = ["updated_at = SYSDATETIMEOFFSET()"];
            if (updates.status !== undefined) {
                req.input("status", sql.NVarChar(32), updates.status);
                setClauses.push("status = @status");
            }
            if (updates.lastError !== undefined) {
                req.input("lastError", sql.NVarChar(sql.MAX), updates.lastError);
                setClauses.push("last_error = @lastError");
            }
            if (updates.blobPath !== undefined) {
                req.input("blobPath", sql.NVarChar(1024), updates.blobPath);
                setClauses.push("blob_path = @blobPath");
            }
            if (updates.attemptCount !== undefined) {
                req.input("attemptCount", sql.Int, updates.attemptCount);
                setClauses.push("attempt_count = @attemptCount");
            }
            if (updates.tenantName !== undefined) {
                req.input("tenantName", sql.NVarChar(255), updates.tenantName);
                setClauses.push("tenant_name = @tenantName");
            }
            req.input("id", sql.UniqueIdentifier, id);
            const result = await req.query(`
        UPDATE dbo.submissions
        SET ${setClauses.join(", ")}
        OUTPUT
          inserted.id, inserted.tenant_id, inserted.property_id,
          inserted.reservation_id, inserted.status, inserted.tenant_name,
          inserted.blob_path, inserted.aad_version, inserted.schema_version,
          inserted.attempt_count, inserted.last_error, inserted.row_version,
          inserted.created_at, inserted.updated_at
        WHERE id = @id
      `);
            if (result.recordset.length === 0)
                return null;
            return mapSubmission(result.recordset[0]);
        });
    }
    async getSubmission(id) {
        const tenantId = await this.getTenantIdForSubmission(id);
        if (!tenantId)
            return null;
        return withTenantContext(tenantId, async (req) => {
            req.input("id", sql.UniqueIdentifier, id);
            const result = await req.query(`
        SELECT id, tenant_id, property_id, reservation_id, status, tenant_name,
               blob_path, aad_version, schema_version, attempt_count, last_error,
               row_version, created_at, updated_at
        FROM dbo.submissions
        WHERE id = @id
      `);
            if (result.recordset.length === 0)
                return null;
            return mapSubmission(result.recordset[0]);
        });
    }
    async getSubmissionWithVersion(id) {
        const tenantId = await this.getTenantIdForSubmission(id);
        if (!tenantId)
            return null;
        return withTenantContext(tenantId, async (req) => {
            req.input("id", sql.UniqueIdentifier, id);
            const result = await req.query(`
        SELECT id, tenant_id, property_id, reservation_id, status, tenant_name,
               blob_path, aad_version, schema_version, attempt_count, last_error,
               row_version, created_at, updated_at
        FROM dbo.submissions
        WHERE id = @id
      `);
            if (result.recordset.length === 0)
                return null;
            const row = result.recordset[0];
            return {
                submission: mapSubmission(row),
                version: rowVersionToNumber(row.row_version)
            };
        });
    }
    async compareAndSwapSubmission(id, expectedVersion, updates) {
        const tenantId = updates.tenantId ?? await this.getTenantIdForSubmission(id);
        if (!tenantId)
            return null;
        return withTenantContext(tenantId, async (req) => {
            const setClauses = ["updated_at = SYSDATETIMEOFFSET()"];
            if (updates.status !== undefined) {
                req.input("status", sql.NVarChar(32), updates.status);
                setClauses.push("status = @status");
            }
            if (updates.lastError !== undefined) {
                req.input("lastError", sql.NVarChar(sql.MAX), updates.lastError);
                setClauses.push("last_error = @lastError");
            }
            if (updates.blobPath !== undefined) {
                req.input("blobPath", sql.NVarChar(1024), updates.blobPath);
                setClauses.push("blob_path = @blobPath");
            }
            if (updates.attemptCount !== undefined) {
                req.input("attemptCount", sql.Int, updates.attemptCount);
                setClauses.push("attempt_count = @attemptCount");
            }
            req
                .input("id", sql.UniqueIdentifier, id)
                .input("expectedVersion", sql.BigInt, expectedVersion);
            const result = await req.query(`
        UPDATE dbo.submissions
        SET ${setClauses.join(", ")}
        OUTPUT
          inserted.id, inserted.tenant_id, inserted.property_id,
          inserted.reservation_id, inserted.status, inserted.tenant_name,
          inserted.blob_path, inserted.aad_version, inserted.schema_version,
          inserted.attempt_count, inserted.last_error, inserted.row_version,
          inserted.created_at, inserted.updated_at
        WHERE id = @id
          AND CONVERT(BIGINT, row_version) = @expectedVersion
      `);
            if (result.recordset.length === 0)
                return null;
            return mapSubmission(result.recordset[0]);
        });
    }
    async setStatus(id, status, lastError) {
        return this.updateSubmission(id, { status, lastError: lastError ?? null });
    }
    // -------------------------------------------------------------------------
    // Encrypted PDF records
    // -------------------------------------------------------------------------
    async setEncryptedPdfRecord(record) {
        await withTenantContext(record.tenantId, async (req) => {
            req
                .input("submissionId", sql.UniqueIdentifier, record.submissionId)
                .input("tenantId", sql.UniqueIdentifier, record.tenantId)
                .input("propertyId", sql.UniqueIdentifier, record.propertyId)
                .input("recordVersion", sql.Int, record.recordVersion)
                .input("cryptoVersion", sql.NVarChar(32), record.cryptoVersion)
                .input("aadVersion", sql.NVarChar(8), String(record.aadVersion))
                .input("templateId", sql.NVarChar(64), record.templateId)
                .input("templateVersion", sql.Int, record.templateVersion)
                .input("pdfSchemaVersion", sql.NVarChar(32), record.pdfSchemaVersion)
                .input("blobPath", sql.NVarChar(1024), record.blobPath)
                .input("contentType", sql.NVarChar(128), record.contentType)
                .input("contentLength", sql.Int, record.contentLength)
                .input("nonceB64", sql.NVarChar(32), record.nonceB64)
                .input("tagB64", sql.NVarChar(32), record.tagB64)
                .input("wrappedDekB64", sql.NVarChar(1024), record.wrappedDekB64)
                .input("kekKeyId", sql.NVarChar(512), record.kekKeyId)
                .input("kekKeyVersion", sql.NVarChar(128), record.kekKeyVersion)
                .input("ciphertextSha256Hex", sql.NChar(64), record.ciphertextSha256Hex)
                .input("aadSha256Hex", sql.NChar(64), record.aadSha256Hex ?? null)
                .input("status", sql.NVarChar(32), record.status)
                .input("attemptCount", sql.Int, record.attemptCount)
                .input("lastError", sql.NVarChar(1024), record.lastError ?? null)
                .input("createdAt", sql.DateTimeOffset, new Date(record.createdAt));
            // HOLDLOCK (SERIALIZABLE for this statement) prevents the classic MERGE
            // race where two concurrent workers both see NOT MATCHED and both INSERT,
            // causing a primary key violation.
            await req.query(`
        MERGE dbo.encrypted_pdf_records WITH (HOLDLOCK) AS target
        USING (SELECT @submissionId AS submission_id) AS source
          ON target.submission_id = source.submission_id
        WHEN MATCHED THEN
          UPDATE SET
            wrapped_dek_b64       = @wrappedDekB64,
            kek_key_id            = @kekKeyId,
            kek_key_version       = @kekKeyVersion,
            ciphertext_sha256_hex = @ciphertextSha256Hex,
            aad_sha256_hex        = @aadSha256Hex,
            status                = @status,
            attempt_count         = @attemptCount,
            last_error            = @lastError
        WHEN NOT MATCHED THEN
          INSERT (submission_id, tenant_id, property_id, record_version,
                  crypto_version, aad_version, template_id, template_version,
                  pdf_schema_version, blob_path, content_type, content_length,
                  nonce_b64, tag_b64, wrapped_dek_b64, kek_key_id, kek_key_version,
                  ciphertext_sha256_hex, aad_sha256_hex, status, attempt_count,
                  last_error, created_at)
          VALUES (@submissionId, @tenantId, @propertyId, @recordVersion,
                  @cryptoVersion, @aadVersion, @templateId, @templateVersion,
                  @pdfSchemaVersion, @blobPath, @contentType, @contentLength,
                  @nonceB64, @tagB64, @wrappedDekB64, @kekKeyId, @kekKeyVersion,
                  @ciphertextSha256Hex, @aadSha256Hex, @status, @attemptCount,
                  @lastError, @createdAt);
      `);
        });
    }
    async getEncryptedPdfRecord(submissionId) {
        const tenantId = await this.getTenantIdForSubmission(submissionId);
        if (!tenantId)
            return null;
        return withTenantContext(tenantId, async (req) => {
            req.input("submissionId", sql.UniqueIdentifier, submissionId);
            const result = await req.query(`
        SELECT submission_id, tenant_id, property_id, record_version,
               crypto_version, aad_version, template_id, template_version,
               pdf_schema_version, blob_path, content_type, content_length,
               nonce_b64, tag_b64, wrapped_dek_b64, kek_key_id, kek_key_version,
               ciphertext_sha256_hex, aad_sha256_hex, status, attempt_count,
               last_error, created_at, row_version
        FROM dbo.encrypted_pdf_records
        WHERE submission_id = @submissionId
      `);
            if (result.recordset.length === 0)
                return null;
            return mapEncryptedPdfRecord(result.recordset[0]);
        });
    }
    async getEncryptedPdfRecordWithVersion(submissionId) {
        const tenantId = await this.getTenantIdForSubmission(submissionId);
        if (!tenantId)
            return null;
        return withTenantContext(tenantId, async (req) => {
            req.input("submissionId", sql.UniqueIdentifier, submissionId);
            const result = await req.query(`
        SELECT submission_id, tenant_id, property_id, record_version,
               crypto_version, aad_version, template_id, template_version,
               pdf_schema_version, blob_path, content_type, content_length,
               nonce_b64, tag_b64, wrapped_dek_b64, kek_key_id, kek_key_version,
               ciphertext_sha256_hex, aad_sha256_hex, status, attempt_count,
               last_error, created_at, row_version
        FROM dbo.encrypted_pdf_records
        WHERE submission_id = @submissionId
      `);
            if (result.recordset.length === 0)
                return null;
            const row = result.recordset[0];
            return {
                record: mapEncryptedPdfRecord(row),
                version: rowVersionToNumber(row.row_version)
            };
        });
    }
    async compareAndSwapEncryptedPdfRecord(submissionId, expectedVersion, updates) {
        const tenantId = updates.tenantId ?? await this.getTenantIdForEncryptedPdfRecord(submissionId);
        if (!tenantId)
            return null;
        return withTenantContext(tenantId, async (req) => {
            const setClauses = [];
            if (updates.wrappedDekB64 !== undefined) {
                req.input("wrappedDekB64", sql.NVarChar(1024), updates.wrappedDekB64);
                setClauses.push("wrapped_dek_b64 = @wrappedDekB64");
            }
            if (updates.kekKeyId !== undefined) {
                req.input("kekKeyId", sql.NVarChar(512), updates.kekKeyId);
                setClauses.push("kek_key_id = @kekKeyId");
            }
            if (updates.kekKeyVersion !== undefined) {
                req.input("kekKeyVersion", sql.NVarChar(128), updates.kekKeyVersion);
                setClauses.push("kek_key_version = @kekKeyVersion");
            }
            if (updates.status !== undefined) {
                req.input("status", sql.NVarChar(32), updates.status);
                setClauses.push("status = @status");
            }
            if (updates.attemptCount !== undefined) {
                req.input("attemptCount", sql.Int, updates.attemptCount);
                setClauses.push("attempt_count = @attemptCount");
            }
            if (updates.lastError !== undefined) {
                req.input("lastError", sql.NVarChar(1024), updates.lastError);
                setClauses.push("last_error = @lastError");
            }
            if (setClauses.length === 0) {
                return this.getEncryptedPdfRecord(submissionId);
            }
            req
                .input("submissionId", sql.UniqueIdentifier, submissionId)
                .input("expectedVersion", sql.BigInt, expectedVersion);
            const result = await req.query(`
        UPDATE dbo.encrypted_pdf_records
        SET ${setClauses.join(", ")}
        OUTPUT
          inserted.submission_id, inserted.tenant_id, inserted.property_id,
          inserted.record_version, inserted.crypto_version, inserted.aad_version,
          inserted.template_id, inserted.template_version, inserted.pdf_schema_version,
          inserted.blob_path, inserted.content_type, inserted.content_length,
          inserted.nonce_b64, inserted.tag_b64, inserted.wrapped_dek_b64,
          inserted.kek_key_id, inserted.kek_key_version,
          inserted.ciphertext_sha256_hex, inserted.aad_sha256_hex,
          inserted.status, inserted.attempt_count, inserted.last_error,
          inserted.created_at, inserted.row_version
        WHERE submission_id = @submissionId
          AND CONVERT(BIGINT, row_version) = @expectedVersion
      `);
            if (result.recordset.length === 0)
                return null;
            return mapEncryptedPdfRecord(result.recordset[0]);
        });
    }
    /**
     * System-only: iterates records across ALL tenants without RLS context.
     * MUST be called only from privileged system processes (rewrap job).
     * In production, the DB account used by the rewrap job must be exempt
     * from the tenant_isolation_policy RLS policy.
     */
    async getEncryptedPdfRecordsByKek(kekKeyId, kekKeyVersion, page) {
        const p = await getPool();
        const req = new sql.Request(p);
        req
            .input("kekKeyId", sql.NVarChar(512), kekKeyId)
            .input("kekKeyVersion", sql.NVarChar(128), kekKeyVersion ?? null)
            .input("offset", sql.Int, page.offset)
            .input("limit", sql.Int, page.limit);
        const result = await req.query(`
      SELECT submission_id, tenant_id, property_id, record_version,
             crypto_version, aad_version, template_id, template_version,
             pdf_schema_version, blob_path, content_type, content_length,
             nonce_b64, tag_b64, wrapped_dek_b64, kek_key_id, kek_key_version,
             ciphertext_sha256_hex, aad_sha256_hex, status, attempt_count,
             last_error, created_at, row_version
      FROM dbo.encrypted_pdf_records
      WHERE kek_key_id = @kekKeyId
        AND (@kekKeyVersion IS NULL OR kek_key_version = @kekKeyVersion)
      ORDER BY submission_id
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);
        return result.recordset.map((row) => ({
            record: mapEncryptedPdfRecord(row),
            version: rowVersionToNumber(row.row_version)
        }));
    }
    // -------------------------------------------------------------------------
    // Audit log (append-only — NEVER UPDATE or DELETE)
    // -------------------------------------------------------------------------
    async addAudit(event) {
        const id = randomUUID();
        const createdAt = new Date();
        const insertAudit = async (req) => {
            req
                .input("id", sql.UniqueIdentifier, id)
                .input("eventType", sql.NVarChar(64), event.eventType)
                .input("correlationId", sql.NVarChar(128), event.correlationId)
                .input("actorType", sql.NVarChar(32), event.actorType)
                .input("actorId", sql.NVarChar(255), event.actorId)
                .input("tenantId", sql.UniqueIdentifier, event.tenantId ?? null)
                .input("propertyId", sql.UniqueIdentifier, event.propertyId ?? null)
                .input("submissionId", sql.UniqueIdentifier, event.submissionId ?? null)
                .input("ip", sql.NVarChar(64), event.ip ?? null)
                .input("userAgent", sql.NVarChar(512), event.userAgent ?? null)
                .input("details", sql.NVarChar(sql.MAX), event.details ? JSON.stringify(event.details) : null)
                .input("createdAt", sql.DateTimeOffset, createdAt);
            await req.query(`
        INSERT INTO dbo.audit_logs
          (id, event_type, correlation_id, actor_type, actor_id,
           tenant_id, property_id, submission_id, ip, user_agent,
           details, created_at)
        VALUES
          (@id, @eventType, @correlationId, @actorType, @actorId,
           @tenantId, @propertyId, @submissionId, @ip, @userAgent,
           @details, @createdAt)
      `);
        };
        if (event.tenantId) {
            // Use tenant context for tenant-scoped audit events so RLS BLOCK predicate is satisfied.
            await withTenantContext(event.tenantId, insertAudit);
        }
        else {
            // System events (tenantId = null): SESSION_CONTEXT not set.
            // The audit_logs RLS BLOCK AFTER INSERT predicate uses fn_tenant_predicate(tenant_id)
            // where tenant_id IS NULL — TRY_CAST returns NULL and the predicate is false,
            // which would block this INSERT.
            //
            // PRODUCTION NOTE: For null-tenant audit events the DB service account must be
            // a member of db_owner or have ALTER ANY SECURITY POLICY permission so it is
            // exempt from the RLS policy, OR the RLS policy must be updated to allow
            // NULL tenant_id inserts. Without that exemption this INSERT will be blocked.
            const p = await getPool();
            await insertAudit(new sql.Request(p));
        }
        return {
            ...event,
            id,
            createdAt: createdAt.toISOString()
        };
    }
    // -------------------------------------------------------------------------
    // Guest token JTIs
    // -------------------------------------------------------------------------
    async markGuestTokenUsed(entry) {
        const p = await getPool();
        const req = new sql.Request(p);
        req
            .input("jti", sql.NVarChar(128), entry.jti)
            .input("tenantId", sql.UniqueIdentifier, entry.tenantId)
            .input("propertyId", sql.UniqueIdentifier, entry.propertyId)
            .input("usedAt", sql.DateTimeOffset, new Date(entry.usedAt))
            .input("expiresAt", sql.DateTimeOffset, new Date(entry.expiresAt));
        await req.query(`
      INSERT INTO dbo.guest_token_jtis (jti, tenant_id, property_id, used_at, expires_at)
      VALUES (@jti, @tenantId, @propertyId, @usedAt, @expiresAt)
    `);
    }
    async getGuestTokenJti(jti) {
        const p = await getPool();
        const req = new sql.Request(p);
        req.input("jti", sql.NVarChar(128), jti);
        const result = await req.query(`
      SELECT jti, tenant_id, property_id, used_at, expires_at
      FROM dbo.guest_token_jtis
      WHERE jti = @jti
    `);
        if (result.recordset.length === 0)
            return null;
        const row = result.recordset[0];
        return {
            jti: row.jti,
            tenantId: row.tenant_id,
            propertyId: row.property_id,
            usedAt: row.used_at.toISOString(),
            expiresAt: row.expires_at.toISOString()
        };
    }
    // -------------------------------------------------------------------------
    // Owner identity / property memberships
    // -------------------------------------------------------------------------
    async getOwnerIdentity(userId, tenantId) {
        const propertyIds = await withTenantContext(tenantId, async (req) => {
            req
                .input("userId", sql.UniqueIdentifier, userId)
                .input("tenantId", sql.UniqueIdentifier, tenantId);
            const result = await req.query(`
        SELECT property_id
        FROM dbo.property_memberships
        WHERE user_id = @userId AND tenant_id = @tenantId
      `);
            return result.recordset.map((r) => r.property_id);
        });
        return { userId, tenantId, propertyIds };
    }
    async addMembership(membership) {
        await withTenantContext(membership.tenantId, async (req) => {
            req
                .input("userId", sql.UniqueIdentifier, membership.userId)
                .input("propertyId", sql.UniqueIdentifier, membership.propertyId)
                .input("tenantId", sql.UniqueIdentifier, membership.tenantId);
            await req.query(`
        INSERT INTO dbo.property_memberships (user_id, property_id, tenant_id)
        VALUES (@userId, @propertyId, @tenantId)
      `);
        });
    }
    // -------------------------------------------------------------------------
    // Encrypted payloads
    // -------------------------------------------------------------------------
    async insertPayload(tenantId, propertyId, submissionId, record) {
        await withTenantContext(tenantId, async (req) => {
            req
                .input("submissionId", sql.UniqueIdentifier, submissionId)
                .input("tenantId", sql.UniqueIdentifier, tenantId)
                .input("propertyId", sql.UniqueIdentifier, propertyId)
                .input("nonce", sql.VarBinary(12), record.nonce)
                .input("tag", sql.VarBinary(16), record.tag)
                .input("ciphertext", sql.VarBinary(sql.MAX), record.ciphertext)
                .input("wrappedDek", sql.VarBinary(1024), record.wrappedDek)
                .input("kekKeyId", sql.NVarChar(512), record.kekKeyId)
                .input("kekKeyVersion", sql.NVarChar(128), record.kekKeyVersion)
                .input("aadVersion", sql.NVarChar(8), String(record.aadVersion))
                .input("schemaVersion", sql.Int, record.schemaVersion)
                .input("ciphertextSha256Hex", sql.NChar(64), record.ciphertextSha256Hex);
            await req.query(`
        INSERT INTO dbo.encrypted_payloads
          (submission_id, tenant_id, property_id, nonce, tag, ciphertext,
           wrapped_dek, kek_key_id, kek_key_version, aad_version,
           schema_version, ciphertext_sha256_hex)
        VALUES
          (@submissionId, @tenantId, @propertyId, @nonce, @tag, @ciphertext,
           @wrappedDek, @kekKeyId, @kekKeyVersion, @aadVersion,
           @schemaVersion, @ciphertextSha256Hex)
      `);
        });
    }
    async getPayload(tenantId, propertyId, submissionId) {
        return withTenantContext(tenantId, async (req) => {
            req
                .input("submissionId", sql.UniqueIdentifier, submissionId)
                .input("tenantId", sql.UniqueIdentifier, tenantId)
                .input("propertyId", sql.UniqueIdentifier, propertyId);
            const result = await req.query(`
        SELECT nonce, tag, ciphertext, wrapped_dek, kek_key_id, kek_key_version,
               aad_version, schema_version, ciphertext_sha256_hex
        FROM dbo.encrypted_payloads
        WHERE submission_id = @submissionId
          AND tenant_id = @tenantId
          AND property_id = @propertyId
      `);
            if (result.recordset.length === 0)
                return null;
            return mapEncryptedPayload(result.recordset[0]);
        });
    }
    // -------------------------------------------------------------------------
    // Submissions list (tenant-scoped, paginated)
    // -------------------------------------------------------------------------
    async listSubmissions(propertyId, tenantId, page) {
        return withTenantContext(tenantId, async (req) => {
            // Explicit tenant_id filter provides defence-in-depth alongside RLS.
            // If RLS is ever bypassed (admin connection, rewrap job, misconfigured pool),
            // this ensures listSubmissions never leaks cross-tenant rows.
            req.input("propertyId", sql.UniqueIdentifier, propertyId);
            req.input("tenantId", sql.UniqueIdentifier, tenantId);
            req.input("offset", sql.Int, page.offset);
            req.input("limit", sql.Int, page.limit);
            const result = await req.query(`
        SELECT *, COUNT(*) OVER () AS total_count
        FROM dbo.submissions
        WHERE property_id = @propertyId
          AND tenant_id = @tenantId
        ORDER BY created_at DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);
            const total = result.recordset[0]?.total_count ?? 0;
            const submissions = result.recordset.map(mapSubmission);
            return { submissions, total };
        });
    }
    // -------------------------------------------------------------------------
    // Private helpers (bypass RLS to read tenantId for context setup)
    // -------------------------------------------------------------------------
    /**
     * Read tenant_id for a submission without tenant context.
     * Used only to determine tenantId before calling withTenantContext.
     * Returns only the tenant_id column — no PII is exposed.
     */
    async getTenantIdForSubmission(id) {
        const p = await getPool();
        const req = new sql.Request(p);
        req.input("id", sql.UniqueIdentifier, id);
        const result = await req.query("SELECT tenant_id FROM dbo.submissions WHERE id = @id");
        return result.recordset[0]?.tenant_id ?? null;
    }
    /**
     * Read tenant_id for an encrypted PDF record without tenant context.
     * Used only to determine tenantId before calling withTenantContext.
     */
    async getTenantIdForEncryptedPdfRecord(submissionId) {
        const p = await getPool();
        const req = new sql.Request(p);
        req.input("submissionId", sql.UniqueIdentifier, submissionId);
        const result = await req.query("SELECT tenant_id FROM dbo.encrypted_pdf_records WHERE submission_id = @submissionId");
        return result.recordset[0]?.tenant_id ?? null;
    }
}
