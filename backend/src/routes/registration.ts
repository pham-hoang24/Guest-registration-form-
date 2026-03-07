import express from "express";
import { z } from "zod";
import { validateBody } from "../middleware/validation.js";
import { verifyGuestToken, isGuestTokenReplay, markGuestTokenUsed } from "../services/guestToken.js";
import { writeAudit } from "../services/audit.js";
import { db } from "../services/db.js";
import { enqueue } from "../services/queue.js";
import { encryptPayload } from "../services/payloadEncryption.js";
import { KeyVaultKekAdapter } from "../crypto/keyVaultKek.js";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

const RegistrationSchema = z.object({
  payload: z.record(z.unknown())
});

const getGuestTokenFromRequest = (req: express.Request) => {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return req.header("x-guest-token") ?? "";
};

export const registrationRouter = () => {
  const router = express.Router();

  router.post(
    "/register",
    validateBody(RegistrationSchema),
    async (req, res) => {
      const correlationId = randomUUID();
      const token = getGuestTokenFromRequest(req);
      if (!token) {
        writeAudit("token_invalid", {
          correlationId,
          actorType: "guest",
          actorId: "unknown",
          ip: req.ip,
          userAgent: req.get("user-agent") ?? undefined
        });
        return res.status(401).json({ error: "missing_token" });
      }

      let claims;
      try {
        claims = verifyGuestToken(token);
      } catch (error) {
        writeAudit("token_invalid", {
          correlationId,
          actorType: "guest",
          actorId: "unknown",
          ip: req.ip,
          userAgent: req.get("user-agent") ?? undefined,
          details: { reason: (error as Error).message }
        });
        return res.status(401).json({ error: "invalid_token" });
      }

      if (await isGuestTokenReplay(claims.jti)) {
        writeAudit("token_replay", {
          correlationId,
          actorType: "guest",
          actorId: claims.jti,
          tenantId: claims.tenantId,
          propertyId: claims.propertyId,
          ip: req.ip,
          userAgent: req.get("user-agent") ?? undefined
        });
        return res.status(409).json({ error: "token_replay" });
      }

      const submissionId = randomUUID();
      const payloadHash = createHash("sha256").update(JSON.stringify(req.body.payload)).digest("hex");
      await db.createSubmission({
        id: submissionId,
        tenantId: claims.tenantId,
        propertyId: claims.propertyId,
        reservationId: claims.reservationId ?? null,
        status: "PENDING_PDF",
        blobPath: null,
        aadVersion: 1,
        schemaVersion: 1,
        attemptCount: 0,
        lastError: null
      });

      let encryptedRecord;
      try {
        const kekAdapter = KeyVaultKekAdapter.fromEnv();
        const raw = JSON.stringify(req.body.payload);
        encryptedRecord = await encryptPayload(
          raw,
          {
            tenantId: claims.tenantId,
            propertyId: claims.propertyId,
            submissionId
          },
          kekAdapter
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "payload_encryption_failed";
        await db.updateSubmission(submissionId, { status: "FAILED", lastError: message });
        writeAudit("submission_failed", {
          correlationId,
          actorType: "guest",
          actorId: claims.jti,
          tenantId: claims.tenantId,
          propertyId: claims.propertyId,
          submissionId,
          ip: req.ip,
          userAgent: req.get("user-agent") ?? undefined,
          details: { reason: message }
        });
        return res.status(500).json({ error: "payload_encryption_failed" });
      }

      try {
        await db.insertPayload(claims.tenantId, claims.propertyId, submissionId, encryptedRecord);
      } catch (err) {
        const message = err instanceof Error ? err.message : "payload_storage_failed";
        await db.updateSubmission(submissionId, { status: "FAILED", lastError: message });
        writeAudit("submission_failed", {
          correlationId,
          actorType: "guest",
          actorId: claims.jti,
          tenantId: claims.tenantId,
          propertyId: claims.propertyId,
          submissionId,
          ip: req.ip,
          userAgent: req.get("user-agent") ?? undefined,
          details: { reason: message }
        });
        return res.status(500).json({ error: "payload_storage_failed" });
      }

      await enqueue({ submissionId });
      await markGuestTokenUsed(claims);

      writeAudit("submission_created", {
        correlationId,
        actorType: "guest",
        actorId: claims.jti,
        tenantId: claims.tenantId,
        propertyId: claims.propertyId,
        submissionId,
        ip: req.ip,
        userAgent: req.get("user-agent") ?? undefined
      });

      // payloadHash intentionally not stored on SubmissionRecord (held in encrypted_payloads)
      void payloadHash;

      res.status(202).json({ submissionId, status: "PENDING_PDF" });
    }
  );

  return router;
};
