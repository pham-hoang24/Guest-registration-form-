import { Router } from "express";
import { encryptString, hashRegistrationToken } from "@gr/crypto";
import { writeAudit } from "@gr/db";
import {
  guestSubmissionRequestSchema,
  REQUIREMENT_VERSION,
  SUPPORTED_LANGUAGES,
} from "@gr/shared";
import { generatePdfForSubmission } from "@gr/worker";
import type { AppDeps } from "../deps.js";
import { sendError } from "../lib/httpErrors.js";
import { auditMetaFromRequest } from "../lib/requestMeta.js";
import { publicRateLimit } from "../middleware/rateLimit.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function publicRegistrationRoutes(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;
  const limiter = publicRateLimit(deps.config);

  /**
   * Resolves a raw URL token to an ACTIVE, unexpired link. Any failure mode
   * (unknown, disabled, expired) is indistinguishable to the caller.
   */
  async function findActiveLink(rawToken: string | undefined) {
    if (!rawToken || rawToken.length > 200) return null;
    const link = await db.registrationLink.findUnique({
      where: { tokenHash: hashRegistrationToken(rawToken) },
      include: { property: true, tenant: { select: { status: true } } },
    });
    if (!link || link.status !== "ACTIVE" || link.tenant.status !== "ACTIVE") return null;
    if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return null;
    return link;
  }

  router.get("/registration-links/:token", limiter, async (req, res, next) => {
    try {
      const link = await findActiveLink(req.params.token);
      if (!link) {
        sendError(res, 404, "invalid_or_expired_link");
        return;
      }
      res.json({
        propertyName: link.property.name,
        propertyCity: link.property.city,
        requirementVersion: REQUIREMENT_VERSION,
        supportedLanguages: SUPPORTED_LANGUAGES,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/registration-links/:token/submissions", limiter, async (req, res, next) => {
    try {
      const link = await findActiveLink(req.params.token);
      if (!link) {
        sendError(res, 404, "invalid_or_expired_link");
        return;
      }

      const parsed = guestSubmissionRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 400, "validation_failed", parsed.error.flatten().fieldErrors);
        return;
      }
      const data = parsed.data;

      const now = new Date();
      const retainUntil = new Date(
        now.getTime() + deps.config.retentionDefaultDays * DAY_MS,
      );
      const deleteAfter = new Date(
        retainUntil.getTime() + deps.config.retentionGraceDays * DAY_MS,
      );

      const submission = await db.guestSubmission.create({
        data: {
          tenantId: link.tenantId,
          propertyId: link.propertyId,
          registrationLinkId: link.id,
          status: "RECEIVED",
          arrivalDate: new Date(`${data.arrivalDate}T00:00:00Z`),
          departureDate: new Date(`${data.departureDate}T00:00:00Z`),
          purposeOfStay: data.purposeOfStay,
          requirementVersion: REQUIREMENT_VERSION,
          guestEmail: data.guestEmail,
          guestPhone: data.guestPhone,
          submittedAt: now,
          retainUntil,
          deleteAfter,
          legalBasis: "LEGAL_OBLIGATION",
        },
      });

      // Document numbers are envelope-encrypted before they touch the database.
      for (const guest of data.guests) {
        await db.guest.create({
          data: {
            submissionId: submission.id,
            firstName: guest.firstName,
            lastName: guest.lastName,
            dateOfBirth: new Date(`${guest.dateOfBirth}T00:00:00Z`),
            nationality: guest.nationality,
            address: guest.address,
            documentType: guest.documentType,
            documentNumberEncrypted: await encryptString({
              plaintext: guest.documentNumber,
              context: { submissionId: submission.id, field: "documentNumber" },
              kms: deps.kms,
            }),
            isPrimaryGuest: guest.isPrimaryGuest,
          },
        });
      }

      await writeAudit(db, {
        tenantId: link.tenantId,
        actorType: "GUEST",
        action: "GUEST_REGISTRATION_SUBMITTED",
        resourceType: "GuestSubmission",
        resourceId: submission.id,
        ...auditMetaFromRequest(req),
        metadata: { guestCount: data.guests.length, registrationLinkId: link.id },
      });

      // MVP: the PDF job runs in-process. Failures mark the submission FAILED
      // and are audit-logged inside the job; the guest still gets their receipt.
      try {
        await generatePdfForSubmission(
          {
            tenantId: link.tenantId,
            propertyId: link.propertyId,
            submissionId: submission.id,
          },
          {
            db,
            kms: deps.kms,
            storage: deps.storage,
            storageProviderName: deps.storageProviderName,
          },
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            level: "error",
            requestId: req.requestId,
            error: "pdf_generation_failed",
            submissionId: submission.id,
            cause: error instanceof Error ? error.name : "UnknownError",
          }),
        );
      }

      res.status(201).json({ submissionId: submission.id, status: "RECEIVED" });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
