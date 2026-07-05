import { decryptString, encryptPdf } from "@gr/crypto";
import { generateRegistrationPdf } from "@gr/pdf";
import { encryptedPdfBlobPath } from "@gr/storage";
import { writeAudit } from "@gr/db";
import type { WorkerDeps } from "./deps.js";

export type GeneratePdfJobInput = {
  tenantId: string;
  propertyId: string;
  submissionId: string;
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Legacy PDF generator — only runs for pre-PR1 submissions that used the old
 * flat GuestSubmission → Guest[] model. PR2 will introduce generatePdfForPassengerCard
 * which owns the PassengerCard SUBMITTED → PDF_READY/FAILED transition.
 *
 * Generates, encrypts and stores the registration PDF for a legacy submission.
 * Plaintext PDF bytes exist in memory only.
 */
export async function generatePdfForSubmission(
  input: GeneratePdfJobInput,
  deps: WorkerDeps,
): Promise<void> {
  const { db, kms, storage } = deps;

  const submission = await db.guestSubmission.findFirst({
    where: {
      id: input.submissionId,
      tenantId: input.tenantId,
      propertyId: input.propertyId,
    },
    include: {
      passengerCards: {
        include: {
          guests: { orderBy: { createdAt: "asc" } },
        },
      },
      property: true,
    },
  });

  if (!submission) {
    throw new Error("Submission not found for tenant/property scope");
  }
  if (submission.property.tenantId !== input.tenantId) {
    throw new Error("Property does not belong to tenant");
  }

  // Flatten guests across all passenger cards for the legacy PDF template.
  const allGuests = submission.passengerCards.flatMap((card) => card.guests);

  try {
    const guests = await Promise.all(
      allGuests.map(async (guest) => {
        // Only decrypt document number if it exists (new model has it optional).
        let documentNumber = "";
        if (guest.documentNumberEncrypted) {
          documentNumber = await decryptString({
            sealed: guest.documentNumberEncrypted,
            context: {
              tenantId: submission.tenantId,
              propertyId: submission.propertyId,
              guestSubmissionId: submission.id,
              // Legacy: use first card's id as a best-effort context; PR2 will handle per-card properly.
              passengerCardId: guest.passengerCardId,
              guestId: guest.id,
              field: "documentNumber",
            },
            kms,
          });
        }

        return {
          firstName: guest.firstName,
          lastName: guest.lastName,
          dateOfBirth: isoDate(guest.dateOfBirth),
          // citizenship replaces old nationality field.
          nationality: guest.citizenship ?? "",
          address: guest.address ?? "",
          documentType: guest.documentType ?? "other",
          documentNumber,
          isPrimaryGuest: guest.guestType === "primary",
        };
      }),
    );

    const pdfBytes = await generateRegistrationPdf({
      submissionId: submission.id,
      requirementVersion: submission.requirementVersion,
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
      departureDate: isoDate(submission.departureDate),
      purposeOfStay: submission.purposeOfStay ?? "",
      guestEmail: submission.primaryGuestEmail ?? "",
      guestPhone: submission.primaryGuestPhoneE164 ?? "",
      guests,
      generatedAt: new Date(),
    });

    const encrypted = await encryptPdf({
      plaintext: pdfBytes,
      context: {
        tenantId: submission.tenantId,
        propertyId: submission.propertyId,
        submissionId: submission.id,
        requirementVersion: submission.requirementVersion,
      },
      kms,
    });

    const blobPath = encryptedPdfBlobPath({
      tenantId: submission.tenantId,
      propertyId: submission.propertyId,
      submissionId: submission.id,
    });
    await storage.putObject({
      path: blobPath,
      contentType: "application/octet-stream",
      body: encrypted.ciphertext,
    });

    await db.encryptedPdf.create({
      data: {
        submissionId: submission.id,
        tenantId: submission.tenantId,
        propertyId: submission.propertyId,
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
    });

    // Legacy status: PR2 uses PassengerCard status transitions instead.
    await db.guestSubmission.update({
      where: { id: submission.id },
      data: { status: "CLOSED" },
    });

    await writeAudit(db, {
      tenantId: submission.tenantId,
      actorType: "SYSTEM",
      action: "PDF_GENERATED",
      resourceType: "GuestSubmission",
      resourceId: submission.id,
      metadata: { kekKeyId: encrypted.kekKeyId, algorithm: encrypted.algorithm },
    });
  } catch (error) {
    await db.guestSubmission.update({
      where: { id: submission.id },
      data: { status: "EXPIRED" },
    });
    await writeAudit(db, {
      tenantId: submission.tenantId,
      actorType: "SYSTEM",
      action: "PDF_GENERATION_FAILED",
      resourceType: "GuestSubmission",
      resourceId: submission.id,
      metadata: { error: error instanceof Error ? error.name : "UnknownError" },
    });
    throw error;
  }
}
