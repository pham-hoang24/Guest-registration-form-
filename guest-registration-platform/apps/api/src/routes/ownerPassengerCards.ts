import type { Request } from "express";
import { Router } from "express";
import { decryptPdf, sha256Hex } from "@gr/crypto";
import { writeAudit } from "@gr/db";
import { PDF_DOWNLOAD_ROLES } from "@gr/shared";
import type { AppDeps } from "../deps.js";
import { sendError } from "../lib/httpErrors.js";
import { auditMetaFromRequest } from "../lib/requestMeta.js";
import { requireRole } from "../middleware/rbac.js";

const PDF_SCHEMA_VERSION = "encrypted-passenger-card-pdf-v1";

/** Best-effort: an audit-write failure must never change the client-visible outcome. */
async function auditPdfFailure(
  deps: AppDeps,
  req: Request,
  input: {
    action: "PDF_DECRYPT_FAILED" | "PDF_INTEGRITY_FAILED";
    tenantId: string;
    passengerCardId: string;
    encryptedPdfId: string;
    reason: string;
  },
): Promise<void> {
  try {
    await writeAudit(deps.db, {
      tenantId: input.tenantId,
      actorType: "OWNER",
      actorId: req.auth!.userId,
      action: input.action,
      resourceType: "PassengerCard",
      resourceId: input.passengerCardId,
      metadata: { encryptedPdfId: input.encryptedPdfId, reason: input.reason },
      ...auditMetaFromRequest(req),
    });
  } catch {
    console.warn(
      JSON.stringify({ level: "warn", event: "audit_write_failed", action: input.action }),
    );
  }
}

export function ownerPassengerCardRoutes(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;

  // One passenger card = one encrypted PDF. Streams it decrypted, never to disk.
  router.get(
    "/:passengerCardId/pdf",
    requireRole(deps, ...PDF_DOWNLOAD_ROLES),
    async (req, res, next) => {
      try {
        const auth = req.auth!;
        res.setHeader("cache-control", "no-store");
        // Tenant-scoped fetch; the encryptedPdf relation is null until the worker runs.
        const card = await db.passengerCard.findFirst({
          where: { id: req.params.passengerCardId, tenantId: auth.tenantId },
          include: { encryptedPdf: true },
        });
        if (!card) {
          sendError(res, 404, "not_found");
          return;
        }
        if (!card.encryptedPdf) {
          sendError(res, 409, "pdf_not_ready");
          return;
        }
        const record = card.encryptedPdf;

        const ciphertext = await deps.storage.getObject({ path: record.blobPath });
        if (sha256Hex(ciphertext) !== record.sha256Ciphertext) {
          await auditPdfFailure(deps, req, {
            action: "PDF_INTEGRITY_FAILED",
            tenantId: card.tenantId,
            passengerCardId: card.id,
            encryptedPdfId: record.id,
            reason: "sha256_mismatch",
          });
          sendError(res, 500, "pdf_unavailable");
          return;
        }

        let plaintext: Buffer;
        try {
          plaintext = await decryptPdf({
            ciphertext,
            encryptedDekBase64: record.encryptedDekBase64,
            ivBase64: record.ivBase64,
            authTagBase64: record.authTagBase64,
            aadJson: record.aadJson,
            kekKeyId: record.kekKeyId,
            kms: deps.kms,
            expectedContext: {
              tenantId: card.tenantId,
              propertyId: card.propertyId,
              guestSubmissionId: record.batchId,
              passengerCardId: card.id,
              requirementVersion: card.requirementVersion,
              schemaVersion: PDF_SCHEMA_VERSION,
            },
          });
        } catch {
          await auditPdfFailure(deps, req, {
            action: "PDF_DECRYPT_FAILED",
            tenantId: card.tenantId,
            passengerCardId: card.id,
            encryptedPdfId: record.id,
            reason: "decrypt_failed",
          });
          sendError(res, 500, "pdf_unavailable");
          return;
        }

        await writeAudit(db, {
          tenantId: auth.tenantId,
          actorType: "OWNER",
          actorId: auth.userId,
          action: "OWNER_DOWNLOADED_PDF",
          resourceType: "PassengerCard",
          resourceId: card.id,
          ...auditMetaFromRequest(req),
          metadata: { encryptedPdfId: record.id, batchId: record.batchId },
        });

        res.setHeader("content-type", "application/pdf");
        res.setHeader(
          "content-disposition",
          `attachment; filename="passenger-card-${card.id}.pdf"`,
        );
        res.send(plaintext);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
