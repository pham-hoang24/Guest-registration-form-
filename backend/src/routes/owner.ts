import express from "express";
import { randomUUID } from "node:crypto";
import { requireOwnerAuth } from "../middleware/ownerAuth.js";
import { writeAudit } from "../services/audit.js";
import { canReadSubmission } from "../services/authz.js";
import { db } from "../services/db.js";
import { unwrapDekWithKeyVault } from "../services/keyVault.js";
import { buildAadBytes } from "../crypto/aad.js";
import { decryptAesGcm } from "../crypto/aesgcm.js";
import { assertHashMatch, hashNonceCiphertextTagHex, sha256Hex } from "../crypto/hashes.js";
import { parseEncryptedPdfRecord } from "../storage/encryptedPdfRecord.js";
import { storage } from "../services/storage.js";

function getOwnerProperties(req: express.Request, res: express.Response): void {
  const owner = req.owner!;
  const properties = owner.propertyIds.map((id) => ({ id }));
  res.status(200).json({ properties });
}

export const ownerRouter = () => {
  const router = express.Router();

  router.use(requireOwnerAuth);

  router.get("/properties", getOwnerProperties);

  // GET /v1/owner/properties/:propertyId/submissions — paginated list
  router.get("/properties/:propertyId/submissions", async (req, res) => {
    const owner = req.owner!;
    const { propertyId } = req.params;

    const identity = await db.getOwnerIdentity(owner.userId, owner.tenantId);
    if (!identity.propertyIds.includes(propertyId)) {
      return res.status(403).json({ error: "forbidden" });
    }

    const rawLimit = parseInt(String(req.query.limit ?? "50"), 10);
    const rawOffset = parseInt(String(req.query.offset ?? "0"), 10);
    const limit = Math.min(isNaN(rawLimit) ? 50 : Math.max(rawLimit, 1), 100);
    const offset = isNaN(rawOffset) ? 0 : Math.max(rawOffset, 0);

    const { submissions, total } = await db.listSubmissions(propertyId, owner.tenantId, { offset, limit });
    return res.status(200).json({ submissions, total, offset, limit });
  });

  // GET /v1/owner/submissions/:id — submission metadata (no PDF)
  router.get("/submissions/:id", async (req, res) => {
    const owner = req.owner!;
    const { allowed, submission } = await canReadSubmission(owner.userId, owner.tenantId, req.params.id);
    if (!allowed || !submission) {
      return res.status(403).json({ error: "forbidden" });
    }
    return res.status(200).json({
      id: submission.id,
      tenantId: submission.tenantId,
      propertyId: submission.propertyId,
      status: submission.status,
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt,
      attemptCount: submission.attemptCount,
      // Return a sanitised indicator rather than the raw internal error message.
      // Raw messages may contain Key Vault URLs, SQL connection strings, or stack traces.
      hasError: submission.lastError != null
    });
  });

  router.get("/submissions/:id/pdf", async (req, res) => {
    const correlationId = req.header("x-correlation-id") || randomUUID();
    const owner = req.owner!;

    const { allowed, reason, submission } = await canReadSubmission(owner.userId, owner.tenantId, req.params.id);
    if (!allowed || !submission) {
      writeAudit("download_denied", {
        correlationId,
        actorType: "owner",
        actorId: owner.userId,
        tenantId: owner.tenantId,
        submissionId: req.params.id,
        ip: req.ip,
        userAgent: req.get("user-agent") ?? undefined,
        details: { reason }
      });
      return res.status(403).json({ error: "forbidden" });
    }

    if (!submission.blobPath) {
      return res.status(404).json({ error: "not_ready" });
    }

    writeAudit("download_started", {
      correlationId,
      actorType: "owner",
      actorId: owner.userId,
      tenantId: submission.tenantId,
      propertyId: submission.propertyId,
      submissionId: submission.id,
      ip: req.ip,
      userAgent: req.get("user-agent") ?? undefined
    });

    const record = await db.getEncryptedPdfRecord(submission.id);
    if (!record) {
      return res.status(404).json({ error: "missing_blob" });
    }

    try {
      const maxPdfBytes = Number(process.env.MAX_PDF_BYTES || 10 * 1024 * 1024);
      const parsedRecord = parseEncryptedPdfRecord(record);
      // Check size BEFORE downloading so we never buffer an oversized blob.
      if (parsedRecord.contentLength > maxPdfBytes) {
        return res.status(413).json({ error: "pdf_too_large" });
      }
      const recordBlob = await storage.get(parsedRecord.blobPath, maxPdfBytes);
      if (!recordBlob) {
        return res.status(404).json({ error: "missing_blob" });
      }
      const dek = await unwrapDekWithKeyVault(
        parsedRecord.wrappedDekB64,
        parsedRecord.kekKeyId,
        parsedRecord.kekKeyVersion
      );
      const aad = buildAadBytes({
        tenantId: parsedRecord.tenantId,
        propertyId: parsedRecord.propertyId,
        submissionId: parsedRecord.submissionId,
        templateId: parsedRecord.templateId,
        templateVersion: parsedRecord.templateVersion,
        pdfSchemaVersion: parsedRecord.pdfSchemaVersion,
        cryptoVersion: parsedRecord.cryptoVersion
      });
      if (parsedRecord.aadSha256Hex) {
        const aadHash = sha256Hex(aad);
        assertHashMatch(parsedRecord.aadSha256Hex, aadHash, "AAD hash");
      }
      const nonce = Buffer.from(parsedRecord.nonceB64, "base64");
      const tag = Buffer.from(parsedRecord.tagB64, "base64");
      const ciphertextHash = hashNonceCiphertextTagHex(nonce, recordBlob.ciphertext, tag);
      assertHashMatch(parsedRecord.ciphertextSha256Hex, ciphertextHash, "Ciphertext hash");
      const plaintext = decryptAesGcm(recordBlob.ciphertext, aad, dek, nonce, tag);
      res.setHeader("Content-Type", parsedRecord.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="submission-${submission.id}.pdf"`);
      res.status(200).send(plaintext);
      writeAudit("download_succeeded", {
        correlationId,
        actorType: "owner",
        actorId: owner.userId,
        tenantId: submission.tenantId,
        propertyId: submission.propertyId,
        submissionId: submission.id,
        ip: req.ip,
        userAgent: req.get("user-agent") ?? undefined
      });
    } catch (error) {
      writeAudit("decrypt_failed", {
        correlationId,
        actorType: "owner",
        actorId: owner.userId,
        tenantId: submission.tenantId,
        propertyId: submission.propertyId,
        submissionId: submission.id,
        details: { reason: (error as Error).message }
      });
      return res.status(500).json({ error: "decrypt_failed" });
    }
  });

  return router;
};
