import { Router } from "express";
import { decryptPdf, sha256Hex } from "@gr/crypto";
import { writeAudit } from "@gr/db";
import { PDF_DOWNLOAD_ROLES } from "@gr/shared";
import type { AppDeps } from "../deps.js";
import { sendError } from "../lib/httpErrors.js";
import { auditMetaFromRequest } from "../lib/requestMeta.js";
import { requireRole } from "../middleware/rbac.js";

const PDF_SCHEMA_VERSION = "encrypted-passenger-card-pdf-v1";

export function ownerPassengerCardRoutes(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;

  // One passenger card = one encrypted PDF. Streams it decrypted, never to disk.
  router.get(
    "/:passengerCardId/pdf",
    requireRole(...PDF_DOWNLOAD_ROLES),
    async (req, res, next) => {
      try {
        const auth = req.auth!;
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
          sendError(res, 500, "integrity_check_failed");
          return;
        }

        const plaintext = await decryptPdf({
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
        res.setHeader("cache-control", "no-store");
        res.send(plaintext);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
