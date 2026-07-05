import type { PrismaClient } from "@prisma/client";
import { REQUIREMENT_VERSION } from "@gr/shared";

export type CreateRegistrationLinkWithStayInput = {
  tenantId: string;
  propertyId: string;
  tokenHash: string;
  arrivalDate: Date;
  departureDate: Date;
  purposeOfStay?: string;
  maxPassengerCards?: number;
};

/**
 * Creates a RegistrationLink (ACTIVE) and a complete GuestSubmission (OPEN)
 * in one call. The stay must be created fully specified — the guest submit
 * path confirms fields only and must not mutate them.
 */
export async function createRegistrationLinkWithStay(
  db: PrismaClient,
  input: CreateRegistrationLinkWithStayInput,
) {
  const link = await db.registrationLink.create({
    data: {
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      tokenHash: input.tokenHash,
      status: "ACTIVE",
    },
  });

  const stay = await db.guestSubmission.create({
    data: {
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      registrationLinkId: link.id,
      status: "OPEN",
      arrivalDate: input.arrivalDate,
      departureDate: input.departureDate,
      purposeOfStay: input.purposeOfStay ?? "Leisure",
      requirementVersion: REQUIREMENT_VERSION,
      maxPassengerCards: input.maxPassengerCards ?? 20,
      legalBasis: "LEGAL_OBLIGATION",
    },
  });

  return { link, stay };
}
