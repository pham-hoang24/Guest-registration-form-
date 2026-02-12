import express from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { writeAudit } from "../services/audit.js";
import { canReadSubmission } from "../services/authz.js";
import { db } from "../services/db.js";
import { unwrapDekWithKeyVault } from "../services/keyVault.js";
import { buildAad, decryptPdf } from "../services/crypto.js";
import { storage } from "../services/storage.js";
import type { OwnerIdentity } from "../types.js";

const ownerJwtSecret = process.env.OWNER_JWT_SECRET || "dev-owner-secret";

const getOwnerFromRequest = (req: express.Request): OwnerIdentity | null => {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  const decoded = jwt.verify(token, ownerJwtSecret) as jwt.JwtPayload;
  return {
    userId: String(decoded.sub),
    tenantId: String(decoded.tenantId),
    propertyIds: Array.isArray(decoded.propertyIds) ? decoded.propertyIds.map(String) : []
  };
};

export const ownerRouter = () => {
  const router = express.Router();

  router.get("/submissions/:id/pdf", async (req, res) => {
    const correlationId = req.header("x-correlation-id") || randomUUID();
    const owner = getOwnerFromRequest(req);
    if (!owner) {
      writeAudit("download_denied", {
        correlationId,
        actorType: "owner",
        actorId: "unknown",
        ip: req.ip,
        userAgent: req.get("user-agent") ?? undefined
      });
      return res.status(401).json({ error: "unauthorized" });
    }

    const { allowed, reason, submission } = canReadSubmission(owner.userId, owner.tenantId, req.params.id);
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

    if (!submission.blobPath || !submission.wrappedDek) {
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

    const blob = await storage.get(submission.blobPath);
    const meta = db.getEncryptionMetadata(submission.id);
    if (!blob || !meta) {
      return res.status(404).json({ error: "missing_blob" });
    }

    try {
      const dek = await unwrapDekWithKeyVault(submission.wrappedDek);
      const aad = buildAad({
        tenantId: submission.tenantId,
        propertyId: submission.propertyId,
        submissionId: submission.id,
        schemaVersion: meta.schemaVersion,
        aadVersion: meta.aadVersion
      });
      const plaintext = decryptPdf(
        blob.ciphertext,
        aad,
        dek,
        Buffer.from(meta.nonce, "base64"),
        Buffer.from(meta.tag, "base64")
      );
      res.setHeader("Content-Type", meta.contentType);
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
