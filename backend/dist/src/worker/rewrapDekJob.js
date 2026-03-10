import { randomUUID } from "node:crypto";
import { awaitAudit } from "../services/audit.js";
import { db } from "../services/db.js";
/**
 * Per-record rewrap logic. Does NOT touch the database.
 * Returns { changed: false } if the record is already on the target key or
 * belongs to a different old key than expected.
 *
 * NOTE: DEK bytes are never logged or returned in error messages.
 */
export const rewrapRecord = async (record, adapter, input) => {
    // Already on the target key — idempotent skip
    if (record.kekKeyId === input.newKekKeyId && record.kekKeyVersion === input.newKekKeyVersion) {
        return { record, changed: false };
    }
    // Belongs to a different old key — do not touch
    if (record.kekKeyId !== input.oldKekKeyId) {
        return { record, changed: false };
    }
    const dek = await adapter.unwrapDek(Buffer.from(record.wrappedDekB64, "base64"), record.kekKeyId, record.kekKeyVersion);
    const wrapped = await adapter.wrapDek(dek);
    const updated = {
        ...record,
        wrappedDekB64: wrapped.wrappedDek.toString("base64"),
        kekKeyId: wrapped.kekKeyId,
        kekKeyVersion: wrapped.kekKeyVersion
    };
    return { record: updated, changed: true };
};
const PAGE_SIZE = 100;
/**
 * Safety cap: if somehow the same records keep appearing (e.g. all fail and
 * stay in the result set), the loop stops after this many pages.
 */
const MAX_PAGES = 10_000;
/**
 * Iterates all EncryptedPdfRecords whose DEK is wrapped with the specified old
 * KEK key/version, unwraps and re-wraps each DEK with the new key, and persists
 * the update via optimistic CAS.
 *
 * Contract:
 * - Per-record errors do NOT abort the batch; they are logged and counted.
 * - CAS conflicts (concurrent rewrap by another process) are not errors; they
 *   are audited as skipped and counted in totalProcessed.
 * - The job is idempotent: re-running with the same newKekKeyId/Version skips
 *   records that are already on the target key.
 * - DEK bytes are never written to logs.
 * - All audit writes are awaited to ensure a durable audit trail.
 *
 * Pagination note: this query always uses OFFSET 0. Because successfully
 * rewrapped records are updated to the new kek_key_id, they leave the
 * WHERE kek_key_id = @old result set naturally. A processedIds set prevents
 * re-processing records that failed and remain in the set.
 *
 * SECURITY: This is a privileged system operation. Only call from authenticated
 * operator contexts (CLI, admin API with explicit auth). Never expose as a
 * public or tenant-scoped endpoint.
 */
export const rewrapDekJob = async (input, adapter) => {
    const correlationId = randomUUID();
    let totalProcessed = 0;
    let totalChanged = 0;
    let totalFailed = 0;
    // IDs of submissions already attempted this run (rewrapped OR failed).
    // Prevents re-processing failed records that remain in the DB result set
    // when we always query at OFFSET 0.
    const processedIds = new Set();
    await awaitAudit("dek_rewrapped", {
        correlationId,
        actorType: "system",
        actorId: "rewrap-job",
        details: {
            phase: "started",
            oldKekKeyId: input.oldKekKeyId,
            oldKekKeyVersion: input.oldKekKeyVersion ?? null,
            newKekKeyId: input.newKekKeyId,
            newKekKeyVersion: input.newKekKeyVersion ?? null
        }
    });
    let pageCount = 0;
    while (true) {
        if (pageCount >= MAX_PAGES) {
            console.error(`[rewrapDekJob] Reached MAX_PAGES (${MAX_PAGES}) — stopping. ` +
                "Some records may remain. Re-run the job to continue.");
            break;
        }
        // Always query at OFFSET 0: rewrapped records leave the result set naturally.
        const page = await db.getEncryptedPdfRecordsByKek(input.oldKekKeyId, input.oldKekKeyVersion, { offset: 0, limit: PAGE_SIZE });
        if (page.length === 0)
            break;
        // Filter out records already attempted this run (e.g. failed → still in set).
        const newRecords = page.filter(({ record }) => !processedIds.has(record.submissionId));
        if (newRecords.length === 0) {
            // Every record in this page was already attempted — no progress possible.
            break;
        }
        for (const { record, version } of newRecords) {
            processedIds.add(record.submissionId);
            try {
                const { record: updated, changed } = await rewrapRecord(record, adapter, input);
                if (!changed) {
                    // Already on target key (idempotent skip) or belongs to different old key.
                    totalProcessed++;
                    continue;
                }
                const swapped = await db.compareAndSwapEncryptedPdfRecord(record.submissionId, version, {
                    wrappedDekB64: updated.wrappedDekB64,
                    kekKeyId: updated.kekKeyId,
                    kekKeyVersion: updated.kekKeyVersion
                });
                if (swapped) {
                    totalChanged++;
                    await awaitAudit("dek_rewrapped", {
                        correlationId,
                        actorType: "system",
                        actorId: "rewrap-job",
                        tenantId: record.tenantId,
                        submissionId: record.submissionId,
                        details: {
                            phase: "record_rewrapped",
                            oldKekKeyId: input.oldKekKeyId,
                            oldKekKeyVersion: input.oldKekKeyVersion ?? null,
                            newKekKeyId: updated.kekKeyId,
                            newKekKeyVersion: updated.kekKeyVersion
                        }
                    });
                }
                else {
                    // CAS conflict: another process rewrapped this record concurrently.
                    // Not an error — the record is on the new key (or will be on next run).
                    await awaitAudit("dek_rewrapped", {
                        correlationId,
                        actorType: "system",
                        actorId: "rewrap-job",
                        tenantId: record.tenantId,
                        submissionId: record.submissionId,
                        details: { skipped: true, reason: "cas_conflict" }
                    });
                }
                // Counts both successful-swap and CAS-conflict paths (changed=true records).
                totalProcessed++;
            }
            catch (err) {
                totalFailed++;
                // Log per-record failure and continue — never abort the batch.
                await awaitAudit("keyvault_error", {
                    correlationId,
                    actorType: "system",
                    actorId: "rewrap-job",
                    tenantId: record.tenantId,
                    submissionId: record.submissionId,
                    details: {
                        reason: err instanceof Error ? err.message : "unknown_error"
                    }
                });
            }
        }
        pageCount++;
    }
    await awaitAudit("dek_rewrapped", {
        correlationId,
        actorType: "system",
        actorId: "rewrap-job",
        details: {
            phase: "completed",
            oldKekKeyId: input.oldKekKeyId,
            newKekKeyId: input.newKekKeyId,
            totalProcessed,
            totalChanged,
            totalFailed
        }
    });
    return { totalProcessed, totalChanged, totalFailed };
};
