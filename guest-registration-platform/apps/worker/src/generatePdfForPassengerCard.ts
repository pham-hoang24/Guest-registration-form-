import { decryptString, encryptPdf } from "@gr/crypto";
import { generateRegistrationPdf, type RegistrationPdfPerson } from "@gr/pdf";
import { encryptedPdfBlobPath } from "@gr/storage";
import { writeAudit } from "@gr/db";
import type { WorkerDeps } from "./deps.js";

export type GeneratePdfJobInput = {
  tenantId: string;
  propertyId: string;
  passengerCardId: string;
};

const PDF_SCHEMA_VERSION = "encrypted-passenger-card-pdf-v1";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Generates, encrypts and stores the registration PDF for a single passenger
 * card. One card = one encrypted PDF. Plaintext PDF bytes exist in memory only;
 * document numbers, PICs and the signature are decrypted transiently here.
 *
 * Owns the PassengerCard SUBMITTED → PDF_READY / FAILED transition. Batch
 * readiness is derived (all cards PDF_READY) — the stay stays OPEN for further
 * submissions, so this never touches GuestSubmission.status.
 */
export async function generatePdfForPassengerCard(
  input: GeneratePdfJobInput,
  deps: WorkerDeps,
): Promise<void> {
  const { db, kms, storage } = deps;

  const card = await db.passengerCard.findFirst({
    where: {
      id: input.passengerCardId,
      tenantId: input.tenantId,
      propertyId: input.propertyId,
    },
    include: {
      guests: { orderBy: { createdAt: "asc" } },
      signature: true,
      guestSubmission: { include: { property: true } },
    },
  });

  if (!card) {
    throw new Error("Passenger card not found for tenant/property scope");
  }

  const submission = card.guestSubmission;
  const context = {
    tenantId: card.tenantId,
    propertyId: card.propertyId,
    guestSubmissionId: submission.id,
    passengerCardId: card.id,
  };

  try {
    if (!card.signature?.signatureEncrypted) {
      throw new Error("Passenger card has no signature");
    }

    // Decrypt the signature PNG (card-level field context; guestId = cardId).
    const signatureB64 = await decryptString({
      sealed: card.signature.signatureEncrypted,
      context: { ...context, guestId: card.id, field: "signature" },
      kms,
    });
    const signaturePng = Buffer.from(signatureB64, "base64");

    // Card holder = the primary / additional adult; the rest are accompanying.
    const holderGuest =
      card.guests.find((g) => g.roleOnCard === "CARD_HOLDER") ?? card.guests[0];
    if (!holderGuest) {
      throw new Error("Passenger card has no guests");
    }

    let documentNumber: string | null = null;
    if (holderGuest.documentNumberEncrypted) {
      documentNumber = await decryptString({
        sealed: holderGuest.documentNumberEncrypted,
        context: { ...context, guestId: holderGuest.id, field: "documentNumber" },
        kms,
      });
    }
    let finnishPersonalIdentityCode: string | null = null;
    if (holderGuest.finnishPersonalIdentityCodeEncrypted) {
      finnishPersonalIdentityCode = await decryptString({
        sealed: holderGuest.finnishPersonalIdentityCodeEncrypted,
        context: { ...context, guestId: holderGuest.id, field: "finnishPersonalIdentityCode" },
        kms,
      });
    }

    const cardHolder: RegistrationPdfPerson = {
      roleOnCard: holderGuest.roleOnCard,
      firstName: holderGuest.firstName,
      lastName: holderGuest.lastName,
      // Identity is PIC-or-DOB: DOB is null when the guest gave a PIC.
      dateOfBirth: holderGuest.dateOfBirth ? isoDate(holderGuest.dateOfBirth) : null,
      citizenship: holderGuest.citizenship,
      isResidentInFinland: holderGuest.isResidentInFinland,
      address: holderGuest.address,
      documentNumber,
      finnishPersonalIdentityCode,
    };

    // Spouse/children ride on the holder's card with name + PIC-or-DOB only.
    const accompanying: RegistrationPdfPerson[] = await Promise.all(
      card.guests
        .filter((g) => g.id !== holderGuest.id)
        .map(async (g) => {
          let accompanyingPic: string | null = null;
          if (g.finnishPersonalIdentityCodeEncrypted) {
            accompanyingPic = await decryptString({
              sealed: g.finnishPersonalIdentityCodeEncrypted,
              context: { ...context, guestId: g.id, field: "finnishPersonalIdentityCode" },
              kms,
            });
          }
          return {
            roleOnCard: g.roleOnCard,
            firstName: g.firstName,
            lastName: g.lastName,
            dateOfBirth: g.dateOfBirth ? isoDate(g.dateOfBirth) : null,
            finnishPersonalIdentityCode: accompanyingPic,
          };
        }),
    );

    const pdfBytes = await generateRegistrationPdf({
      guestSubmissionId: submission.id,
      passengerCardId: card.id,
      cardNumber: card.cardNumber,
      cardType: card.cardType,
      requirementVersion: card.requirementVersion,
      property: {
        name: submission.property.name,
        addressLine1: submission.property.addressLine1,
        addressLine2: submission.property.addressLine2,
        postalCode: submission.property.postalCode,
        city: submission.property.city,
        countryCode: submission.property.countryCode,
        businessId: submission.property.businessId,
      },
      arrivalDate: isoDate(submission.arrivalDate),
      departureDate: submission.departureDate ? isoDate(submission.departureDate) : null,
      departureDateKnown: submission.departureDateKnown,
      purposeOfStay: submission.purposeOfStay ?? "",
      countryOfEntryToFinland: card.countryOfEntryToFinland,
      countryOfEntryNotApplicableReason: card.countryOfEntryNotApplicableReason,
      cardHolder,
      accompanying,
      signaturePng,
      signedAt: card.signature.signedAt,
      generatedAt: new Date(),
    });

    const encrypted = await encryptPdf({
      plaintext: pdfBytes,
      context: {
        tenantId: card.tenantId,
        propertyId: card.propertyId,
        guestSubmissionId: submission.id,
        passengerCardId: card.id,
        requirementVersion: card.requirementVersion,
        schemaVersion: PDF_SCHEMA_VERSION,
      },
      kms,
    });

    const blobPath = encryptedPdfBlobPath({
      tenantId: card.tenantId,
      propertyId: card.propertyId,
      batchId: submission.id,
      passengerCardId: card.id,
    });
    await storage.putObject({
      path: blobPath,
      contentType: "application/octet-stream",
      body: encrypted.ciphertext,
    });

    await db.$transaction([
      db.encryptedPdf.create({
        data: {
          passengerCardId: card.id,
          batchId: submission.id,
          tenantId: card.tenantId,
          propertyId: card.propertyId,
          storageProvider: deps.storageProviderName,
          blobPath,
          encryptedDekBase64: encrypted.encryptedDekBase64,
          ivBase64: encrypted.ivBase64,
          authTagBase64: encrypted.authTagBase64,
          aadJson: encrypted.aadJson,
          kekKeyId: encrypted.kekKeyId,
          algorithm: encrypted.algorithm,
          sha256Ciphertext: encrypted.sha256Ciphertext,
        },
      }),
      db.passengerCard.update({
        where: { id: card.id },
        data: { status: "PDF_READY" },
      }),
      db.pdfJob.update({
        where: { passengerCardId: card.id },
        data: { status: "COMPLETED" },
      }),
    ]);

    await writeAudit(db, {
      tenantId: card.tenantId,
      actorType: "SYSTEM",
      action: "PDF_GENERATED",
      resourceType: "PassengerCard",
      resourceId: card.id,
      metadata: { kekKeyId: encrypted.kekKeyId, algorithm: encrypted.algorithm, batchId: submission.id },
    });
  } catch (error) {
    await db.$transaction([
      db.passengerCard.update({ where: { id: card.id }, data: { status: "FAILED" } }),
      db.pdfJob.update({ where: { passengerCardId: card.id }, data: { status: "FAILED" } }),
    ]);
    await writeAudit(db, {
      tenantId: card.tenantId,
      actorType: "SYSTEM",
      action: "PDF_GENERATION_FAILED",
      resourceType: "PassengerCard",
      resourceId: card.id,
      metadata: { error: error instanceof Error ? error.name : "UnknownError" },
    });
    throw error;
  }
}
