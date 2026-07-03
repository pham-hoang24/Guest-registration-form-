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
 * Generates, encrypts and stores the registration PDF for a submission.
 * Plaintext PDF bytes exist in memory only. The job refetches everything
 * scoped by tenantId + propertyId — it never trusts the queue payload beyond
 * using it as a lookup key.
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
      guests: { orderBy: { createdAt: "asc" } },
      property: true,
    },
  });

  if (!submission) {
    throw new Error("Submission not found for tenant/property scope");
  }
  if (submission.property.tenantId !== input.tenantId) {
    throw new Error("Property does not belong to tenant");
  }

  try {
    const guests = await Promise.all(
      submission.guests.map(async (guest) => ({
        firstName: guest.firstName,
        lastName: guest.lastName,
        dateOfBirth: isoDate(guest.dateOfBirth),
        nationality: guest.nationality,
        address: guest.address,
        documentType: guest.documentType,
        documentNumber: await decryptString({
          sealed: guest.documentNumberEncrypted,
          context: { submissionId: submission.id, field: "documentNumber" },
          kms,
        }),
        isPrimaryGuest: guest.isPrimaryGuest,
      })),
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
      purposeOfStay: submission.purposeOfStay,
      guestEmail: submission.guestEmail ?? "",
      guestPhone: submission.guestPhone ?? "",
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

    await db.guestSubmission.update({
      where: { id: submission.id },
      data: { status: "PDF_READY" },
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
      data: { status: "FAILED" },
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
