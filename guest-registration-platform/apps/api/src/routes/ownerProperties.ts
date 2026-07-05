import { Router } from "express";
import type { AppDeps } from "../deps.js";
import { sendError } from "../lib/httpErrors.js";

export function ownerPropertyRoutes(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;

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
          departureDate: s.departureDate.toISOString().slice(0, 10),
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

  return router;
}
