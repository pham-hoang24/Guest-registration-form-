import express from "express";
import { z } from "zod";
import { validateBody } from "../middleware/validation.js";
import { verifyGuestToken, isGuestTokenReplay, markGuestTokenUsed } from "../services/guestToken.js";
import { writeAudit } from "../services/audit.js";
import { db } from "../services/db.js";
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

      if (isGuestTokenReplay(claims.jti)) {
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
      db.createSubmission({
        id: submissionId,
        tenantId: claims.tenantId,
        propertyId: claims.propertyId,
        reservationId: claims.reservationId ?? null,
        status: "PENDING_PDF",
        blobPath: null,
        wrappedDek: null,
        kekKeyId: null,
        kekKeyVersion: null,
        contentHash: payloadHash,
        aadVersion: 1,
        schemaVersion: 1,
        attemptCount: 0,
        lastError: null
      });

      markGuestTokenUsed(claims);

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

      // MVP stub: enqueue job in worker queue
      res.status(202).json({ submissionId, status: "PENDING_PDF" });
    }
  );

  return router;
};
