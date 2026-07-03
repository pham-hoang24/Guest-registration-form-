import { Router } from "express";
import { decryptPdf, sha256Hex } from "@gr/crypto";
import { writeAudit } from "@gr/db";
import { PDF_DOWNLOAD_ROLES } from "@gr/shared";
import type { AppDeps } from "../deps.js";
import { sendError } from "../lib/httpErrors.js";
import { auditMetaFromRequest } from "../lib/requestMeta.js";
import { requireRole } from "../middleware/rbac.js";

export function ownerSubmissionRoutes(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;

  router.get("/:submissionId", async (req, res, next) => {
    try {
      const auth = req.auth!;
      // Tenant-scoped: never fetch by id alone.
      const submission = await db.guestSubmission.findFirst({
        where: { id: req.params.submissionId, tenantId: auth.tenantId },
        include: {
          property: { select: { id: true, name: true, city: true } },
          guests: {
            orderBy: { createdAt: "asc" },
            // documentNumberEncrypted deliberately excluded: the document
            // number is only ever visible inside the decrypted PDF.
            select: {
              id: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
              nationality: true,
              documentType: true,
              isPrimaryGuest: true,
            },
          },
          encryptedPdf: { select: { id: true, createdAt: true } },
        },
      });
      if (!submission) {
        sendError(res, 404, "not_found");
        return;
      }

      await writeAudit(db, {
        tenantId: auth.tenantId,
        actorType: "OWNER",
        actorId: auth.userId,
        action: "OWNER_VIEWED_SUBMISSION",
        resourceType: "GuestSubmission",
        resourceId: submission.id,
        ...auditMetaFromRequest(req),
      });

      res.json({
        id: submission.id,
        status: submission.status,
        property: submission.property,
        arrivalDate: submission.arrivalDate.toISOString().slice(0, 10),
        departureDate: submission.departureDate.toISOString().slice(0, 10),
        purposeOfStay: submission.purposeOfStay,
        requirementVersion: submission.requirementVersion,
        guestEmail: submission.guestEmail,
        guestPhone: submission.guestPhone,
        submittedAt: submission.submittedAt.toISOString(),
        retainUntil: submission.retainUntil.toISOString(),
        legalBasis: submission.legalBasis,
        pdfAvailable: submission.status === "PDF_READY" && submission.encryptedPdf !== null,
        guests: submission.guests.map((g) => ({
          ...g,
          dateOfBirth: g.dateOfBirth.toISOString().slice(0, 10),
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/:submissionId/pdf",
    requireRole(...PDF_DOWNLOAD_ROLES),
    async (req, res, next) => {
      try {
        const auth = req.auth!;
        const submission = await db.guestSubmission.findFirst({
          where: { id: req.params.submissionId, tenantId: auth.tenantId },
          include: { encryptedPdf: true },
        });
        if (!submission) {
          sendError(res, 404, "not_found");
          return;
        }
        if (submission.status !== "PDF_READY" || !submission.encryptedPdf) {
          sendError(res, 409, "pdf_not_ready");
          return;
        }
        const record = submission.encryptedPdf;

        const ciphertext = await deps.storage.getObject({ path: record.blobPath });
        if (sha256Hex(ciphertext) !== record.sha256Ciphertext) {
          sendError(res, 500, "integrity_check_failed");
          return;
        }

        // AAD binding: the record must decrypt under the tenant/property/
        // submission context of the row it was fetched through.
        const plaintext = await decryptPdf({
          ciphertext,
          encryptedDekBase64: record.encryptedDekBase64,
          ivBase64: record.ivBase64,
          authTagBase64: record.authTagBase64,
          aadJson: record.aadJson,
          kekKeyId: record.kekKeyId,
          kms: deps.kms,
          expectedContext: {
            tenantId: submission.tenantId,
            propertyId: submission.propertyId,
            submissionId: submission.id,
            requirementVersion: submission.requirementVersion,
          },
        });

        await writeAudit(db, {
          tenantId: auth.tenantId,
          actorType: "OWNER",
          actorId: auth.userId,
          action: "OWNER_DOWNLOADED_PDF",
          resourceType: "GuestSubmission",
          resourceId: submission.id,
          ...auditMetaFromRequest(req),
          metadata: { encryptedPdfId: record.id },
        });

        res.setHeader("content-type", "application/pdf");
        res.setHeader(
          "content-disposition",
          `attachment; filename="registration-${submission.id}.pdf"`,
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
