import type { PrismaClient } from "@prisma/client";
import { REQUIREMENT_VERSION } from "@gr/shared";

export type CreateRegistrationLinkWithStayInput = {
  tenantId: string;
  propertyId: string;
  tokenHash: string;
  arrivalDate: Date;
  /** Omit together with departureDateKnown=false for an unknown-departure stay. */
  departureDate?: Date | null;
  departureDateKnown?: boolean;
  purposeOfStay?: string;
  maxPassengerCards?: number;
};

/**
 * Creates a RegistrationLink (ACTIVE) and a complete GuestSubmission (OPEN)
 * in one call. The stay must be created fully specified — the guest submit
 * path confirms fields only and must not mutate them.
 *
 * A property may hold at most one ACTIVE link (partial unique index
 * `registration_link_one_active_per_property`), so this first retires any prior
 * ACTIVE link (→ REVOKED) and its OPEN stay (→ EXPIRED) in the same transaction
 * — mirroring the real regenerate endpoint — making the helper safe to call on a
 * property that already has an active link.
 */
export async function createRegistrationLinkWithStay(
  db: PrismaClient,
  input: CreateRegistrationLinkWithStayInput,
) {
  return db.$transaction(async (tx) => {
    await tx.registrationLink.updateMany({
      where: { propertyId: input.propertyId, status: "ACTIVE" },
      data: { status: "REVOKED" },
    });
    await tx.guestSubmission.updateMany({
      where: { propertyId: input.propertyId, status: "OPEN" },
      data: { status: "EXPIRED" },
    });

    const link = await tx.registrationLink.create({
      data: {
        tenantId: input.tenantId,
        propertyId: input.propertyId,
        tokenHash: input.tokenHash,
        status: "ACTIVE",
      },
    });

    const stay = await tx.guestSubmission.create({
      data: {
        tenantId: input.tenantId,
        propertyId: input.propertyId,
        registrationLinkId: link.id,
        status: "OPEN",
        arrivalDate: input.arrivalDate,
        departureDate: input.departureDate ?? null,
        departureDateKnown: input.departureDateKnown ?? input.departureDate != null,
        purposeOfStay: input.purposeOfStay ?? "Leisure",
        requirementVersion: REQUIREMENT_VERSION,
        maxPassengerCards: input.maxPassengerCards ?? 20,
        legalBasis: "LEGAL_OBLIGATION",
      },
    });

    return { link, stay };
  });
}
