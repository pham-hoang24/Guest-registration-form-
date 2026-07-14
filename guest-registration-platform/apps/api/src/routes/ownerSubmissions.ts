import { Router } from "express";
import { writeAudit } from "@gr/db";
import type { AppDeps } from "../deps.js";
import { sendError } from "../lib/httpErrors.js";
import { auditMetaFromRequest } from "../lib/requestMeta.js";

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
          passengerCards: {
            orderBy: { cardNumber: "asc" },
            select: {
              id: true,
              cardNumber: true,
              cardType: true,
              status: true,
              submittedAt: true,
              countryOfEntryToFinland: true,
              countryOfEntryNotApplicableReason: true,
              // documentNumberEncrypted deliberately excluded — only visible inside the PDF.
              guests: {
                select: {
                  id: true,
                  guestType: true,
                  roleOnCard: true,
                  firstName: true,
                  lastName: true,
                  dateOfBirth: true,
                  citizenship: true,
                  isAdult: true,
                },
              },
              // Presence marks the card's PDF as downloadable (never expose crypto material).
              encryptedPdf: { select: { id: true } },
            },
          },
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

      const passengerCards = submission.passengerCards.map((card) => ({
        id: card.id,
        cardNumber: card.cardNumber,
        cardType: card.cardType,
        status: card.status,
        submittedAt: card.submittedAt.toISOString(),
        countryOfEntryToFinland: card.countryOfEntryToFinland,
        countryOfEntryNotApplicableReason: card.countryOfEntryNotApplicableReason,
        // Each passenger card is its own PDF; download via /passenger-cards/:id/pdf.
        pdfAvailable: card.encryptedPdf !== null,
        guests: card.guests.map((g) => ({
          ...g,
          // DOB is null on the PIC path (identity is PIC-or-DOB).
          dateOfBirth: g.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        })),
      }));

      res.json({
        id: submission.id,
        status: submission.status,
        property: submission.property,
        arrivalDate: submission.arrivalDate.toISOString().slice(0, 10),
        // Departure is always supplied (owner sets it on link creation; guest
        // confirms it at submission); kept nullable only for pre-Tier-3E rows.
        departureDate: submission.departureDate?.toISOString().slice(0, 10) ?? null,
        departureDateKnown: submission.departureDateKnown,
        purposeOfStay: submission.purposeOfStay,
        requirementVersion: submission.requirementVersion,
        submittedAt: submission.submittedAt.toISOString(),
        retainUntil: submission.retainUntil?.toISOString() ?? null,
        legalBasis: submission.legalBasis,
        // Batch is "ready" once every card has produced its PDF.
        batchReady: passengerCards.length > 0 && passengerCards.every((c) => c.pdfAvailable),
        passengerCards,
        guestCount: submission.passengerCards.reduce((n, c) => n + c.guests.length, 0),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
