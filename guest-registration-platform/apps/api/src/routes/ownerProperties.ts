import { Router } from "express";
import { generateRegistrationToken, hashRegistrationToken } from "@gr/crypto";
import { writeAudit } from "@gr/db";
import { activeRegistrationLinkRequestSchema, REQUIREMENT_VERSION } from "@gr/shared";
import type { AppDeps } from "../deps.js";
import { sendError } from "../lib/httpErrors.js";
import { auditMetaFromRequest } from "../lib/requestMeta.js";
import { requireRole } from "../middleware/rbac.js";
import { activeLinkRateLimit } from "../middleware/rateLimit.js";

const HOUR_MS = 60 * 60 * 1000;

export function ownerPropertyRoutes(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;

  // Built once per router so the underlying store — in-memory or Redis —
  // accumulates counts across requests (see rateLimit.ts doc comments).
  const activeLinkLimiter = activeLinkRateLimit(deps.config, deps.activeLinkRateLimitStore);

  router.get("/", async (req, res, next) => {
    try {
      const auth = req.auth!;
      const properties = await db.property.findMany({
        where: { tenantId: auth.tenantId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          addressLine1: true,
          addressLine2: true,
          postalCode: true,
          city: true,
          countryCode: true,
          businessId: true,
        },
      });
      res.json({ properties });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:propertyId/submissions", async (req, res, next) => {
    try {
      const auth = req.auth!;
      // Tenant-scoped lookup: a propertyId from another tenant is a plain 404.
      const property = await db.property.findFirst({
        where: { id: req.params.propertyId, tenantId: auth.tenantId },
        select: { id: true, name: true },
      });
      if (!property) {
        sendError(res, 404, "not_found");
        return;
      }

      const submissions = await db.guestSubmission.findMany({
        where: { propertyId: property.id, tenantId: auth.tenantId },
        orderBy: { submittedAt: "desc" },
        select: {
          id: true,
          status: true,
          arrivalDate: true,
          departureDate: true,
          purposeOfStay: true,
          requirementVersion: true,
          submittedAt: true,
          _count: { select: { passengerCards: true } },
        },
      });

      res.json({
        property,
        submissions: submissions.map((s) => ({
          id: s.id,
          status: s.status,
          arrivalDate: s.arrivalDate.toISOString().slice(0, 10),
          departureDate: s.departureDate?.toISOString().slice(0, 10) ?? null,
          purposeOfStay: s.purposeOfStay,
          requirementVersion: s.requirementVersion,
          submittedAt: s.submittedAt.toISOString(),
          cardCount: s._count.passengerCards,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Create (or replace) a property's single active registration link.
   *
   * OWNER/MANAGER only — VIEWER gets a 403 with an UNAUTHORIZED_ACCESS_ATTEMPT
   * audit row (via requireRole) and never sees a link. The rate limiter runs
   * AFTER requireRole so a rejected VIEWER never consumes property quota.
   *
   * The raw token is returned exactly once, with `no-store`; only its hash is
   * persisted. The audit row carries counts/ids only — never token/hash/url/QR.
   */
  router.post(
    "/:propertyId/active-registration-link",
    requireRole(deps, "OWNER", "MANAGER"),
    activeLinkLimiter,
    async (req, res, next) => {
      try {
        const auth = req.auth!;

        const property = await db.property.findFirst({
          where: { id: req.params.propertyId, tenantId: auth.tenantId },
          select: { id: true },
        });
        if (!property) {
          sendError(res, 404, "not_found");
          return;
        }

        const parsed = activeRegistrationLinkRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(res, 400, "validation_failed", parsed.error.flatten().fieldErrors);
          return;
        }
        const { arrivalDate, departureDate, maxPassengerCards, linkTtlHours } = parsed.data;

        const rawToken = generateRegistrationToken();
        const tokenHash = hashRegistrationToken(rawToken);
        const createdAt = new Date();
        const expiresAt = new Date(createdAt.getTime() + linkTtlHours * HOUR_MS);

        type TxResult = {
          newLinkId: string;
          newGuestSubmissionId: string;
          previousActiveRevokedCount: number;
          previousEmptyExpiredCount: number;
          previousSubmittedClosedCount: number;
        };

        let result: TxResult;
        try {
          result = await db.$transaction(async (tx) => {
            // Revoke every prior ACTIVE link for this property.
            const revoked = await tx.registrationLink.updateMany({
              where: { propertyId: property.id, tenantId: auth.tenantId, status: "ACTIVE" },
              data: { status: "REVOKED" },
            });

            // Retire prior OPEN submissions: empty → EXPIRED, submitted → CLOSED.
            const openSubs = await tx.guestSubmission.findMany({
              where: { propertyId: property.id, tenantId: auth.tenantId, status: "OPEN" },
              select: { id: true, _count: { select: { passengerCards: true } } },
            });
            const emptyIds = openSubs.filter((s) => s._count.passengerCards === 0).map((s) => s.id);
            const submittedIds = openSubs
              .filter((s) => s._count.passengerCards > 0)
              .map((s) => s.id);

            if (emptyIds.length > 0) {
              await tx.guestSubmission.updateMany({
                where: { id: { in: emptyIds } },
                data: { status: "EXPIRED" },
              });
            }
            if (submittedIds.length > 0) {
              await tx.guestSubmission.updateMany({
                where: { id: { in: submittedIds } },
                data: { status: "CLOSED" },
              });
            }

            // Create the new ACTIVE link. The partial unique index guarantees at
            // most one ACTIVE link per property — a concurrent create trips P2002.
            const link = await tx.registrationLink.create({
              data: {
                tenantId: auth.tenantId,
                propertyId: property.id,
                tokenHash,
                status: "ACTIVE",
                expiresAt,
              },
              select: { id: true },
            });

            const stay = await tx.guestSubmission.create({
              data: {
                tenantId: auth.tenantId,
                propertyId: property.id,
                registrationLinkId: link.id,
                status: "OPEN",
                arrivalDate: new Date(`${arrivalDate}T00:00:00Z`),
                departureDate: new Date(`${departureDate}T00:00:00Z`),
                departureDateKnown: true,
                // Purpose is set by the first guest card (3B); the owner never sets it.
                purposeOfStay: null,
                requirementVersion: REQUIREMENT_VERSION,
                maxPassengerCards,
                legalBasis: "LEGAL_OBLIGATION",
              },
              select: { id: true },
            });

            return {
              newLinkId: link.id,
              newGuestSubmissionId: stay.id,
              previousActiveRevokedCount: revoked.count,
              previousEmptyExpiredCount: emptyIds.length,
              previousSubmittedClosedCount: submittedIds.length,
            };
          });
        } catch (err: unknown) {
          // P2002 on the partial unique index: a concurrent request won the race.
          // Return no URL and write no audit event.
          if (
            err != null &&
            typeof err === "object" &&
            "code" in err &&
            (err as { code: string }).code === "P2002"
          ) {
            sendError(res, 409, "active_link_conflict");
            return;
          }
          throw err;
        }

        await writeAudit(db, {
          tenantId: auth.tenantId,
          actorType: "OWNER",
          actorId: auth.userId,
          action: "REGISTRATION_LINK_REGENERATED",
          resourceType: "RegistrationLink",
          resourceId: result.newLinkId,
          ...auditMetaFromRequest(req),
          metadata: {
            propertyId: property.id,
            newGuestSubmissionId: result.newGuestSubmissionId,
            previousActiveRevokedCount: result.previousActiveRevokedCount,
            previousEmptyExpiredCount: result.previousEmptyExpiredCount,
            previousSubmittedClosedCount: result.previousSubmittedClosedCount,
            expiresAt: expiresAt.toISOString(),
            linkTtlHours,
          },
        });

        const url = new URL(`/registration/${rawToken}`, deps.config.publicAppUrl).toString();

        // The raw token/URL is a secret capability shown exactly once.
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Pragma", "no-cache");
        res.status(201).json({
          url,
          createdAt: createdAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          linkTtlHours,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
