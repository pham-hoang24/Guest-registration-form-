import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { LocalKmsProvider, encryptString } from "@gr/crypto";
import { PrismaClient, createRegistrationLinkWithStay } from "@gr/db";
import { LocalStorageProvider } from "@gr/storage";
import { runRetentionCleanup } from "../src/retention.js";

const db = new PrismaClient();
const kms = new LocalKmsProvider(Buffer.alloc(32, 9).toString("base64"));
const storage = new LocalStorageProvider(mkdtempSync(path.join(tmpdir(), "gr-worker-test-")));

async function truncateAll() {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "PdfJob", "PassengerCardSignature", "PassengerCard", ' +
      '"EncryptedPdf", "Guest", "GuestSubmission", ' +
      '"RegistrationLink", "Property", "OwnerUser", "Tenant" CASCADE',
  );
}

/**
 * Creates a stay with one passenger card containing one primary guest.
 * Sets deleteAfter to the provided date.
 */
async function seedStay(deleteAfter: Date) {
  const tenant = await db.tenant.create({ data: { name: "T" } });
  const property = await db.property.create({
    data: {
      tenantId: tenant.id,
      name: "Cabin",
      addressLine1: "Street 1",
      postalCode: "33100",
      city: "Tampere",
      countryCode: "FI",
    },
  });

  const { stay } = await createRegistrationLinkWithStay(db, {
    tenantId: tenant.id,
    propertyId: property.id,
    tokenHash: `hash-${Date.now()}`,
    arrivalDate: new Date("2026-07-20"),
    departureDate: new Date("2026-07-23"),
    purposeOfStay: "Leisure",
  });

  // Set retention dates (simulates having submitted at least one card).
  const updatedStay = await db.guestSubmission.update({
    where: { id: stay.id },
    data: {
      retainUntil: deleteAfter,
      deleteAfter,
      primaryGuestName: "Anna Example",
      primaryGuestEmail: "guest@example.com",
      primaryGuestPhoneE164: "+358401234567",
    },
  });

  const cardId = randomUUID();
  const guestId = randomUUID();

  const context = {
    tenantId: tenant.id,
    propertyId: property.id,
    guestSubmissionId: stay.id,
    passengerCardId: cardId,
    guestId,
  };

  const documentNumberEncrypted = await encryptString({
    plaintext: "X1234567",
    context: { ...context, field: "documentNumber" },
    kms,
  });

  const signatureEncrypted = await encryptString({
    plaintext: "base64pngdata",
    context: { ...context, field: "signature" },
    kms,
  });

  await db.passengerCard.create({
    data: {
      id: cardId,
      guestSubmissionId: stay.id,
      tenantId: tenant.id,
      propertyId: property.id,
      cardNumber: 1,
      cardType: "PRIMARY_WITH_ALLOWED_FAMILY",
      submissionFingerprint: `fp-${Date.now()}`,
      requirementVersion: "FI-ACCOMMODATION-2026-01",
      guests: {
        create: {
          id: guestId,
          tenantId: tenant.id,
          propertyId: property.id,
          guestType: "primary",
          roleOnCard: "primary",
          firstName: "Anna",
          lastName: "Example",
          dateOfBirth: new Date("1990-04-12"),
          citizenship: "FI",
          isResidentInFinland: true,
          address: "Example Street 1",
          documentType: "passport",
          documentNumberEncrypted,
          email: "guest@example.com",
          isAdult: true,
        },
      },
      signature: {
        create: {
          tenantId: tenant.id,
          propertyId: property.id,
          signatureEncrypted,
          signatureSha256: "aaaa".repeat(16),
        },
      },
      pdfJob: {
        create: {
          tenantId: tenant.id,
          propertyId: property.id,
          status: "PENDING",
        },
      },
    },
  });

  return { tenant, property, stay: updatedStay };
}

beforeEach(truncateAll);

afterAll(async () => {
  await db.$disconnect();
});

describe("runRetentionCleanup", () => {
  it("wipes PII, signatures and contact fields, marks deletedAt, and audits it", async () => {
    const past = new Date(Date.now() - 1000);
    const { tenant, stay } = await seedStay(past);

    const result = await runRetentionCleanup({ db, storage });
    expect(result.deletedSubmissionIds).toEqual([stay.id]);

    const cleaned = await db.guestSubmission.findFirst({
      where: { id: stay.id, tenantId: tenant.id },
      include: {
        passengerCards: {
          include: {
            guests: true,
            signature: true,
          },
        },
      },
    });
    expect(cleaned!.deletedAt).not.toBeNull();
    expect(cleaned!.primaryGuestEmail).toBeNull();
    expect(cleaned!.primaryGuestPhoneE164).toBeNull();
    expect(cleaned!.primaryGuestName).toBeNull();

    // Guest credentials wiped.
    const guest = cleaned!.passengerCards[0]!.guests[0]!;
    expect(guest.documentNumberEncrypted).toBeNull();
    expect(guest.email).toBeNull();

    // Signature encrypted bytes wiped.
    const sig = cleaned!.passengerCards[0]!.signature!;
    expect(sig.signatureEncrypted).toBeNull();
    // signatureSha256 and passengerCardId retained for audit trail.
    expect(sig.signatureSha256).toBeTruthy();

    const audit = await db.auditLog.findFirst({
      where: { action: "RETENTION_DELETED_SUBMISSION", resourceId: stay.id },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorType).toBe("SYSTEM");
  });

  it("leaves unexpired stays untouched", async () => {
    const { stay } = await seedStay(new Date("2099-01-01"));
    const result = await runRetentionCleanup({ db, storage });
    expect(result.deletedSubmissionIds).toEqual([]);
    const untouched = await db.guestSubmission.findUnique({ where: { id: stay.id } });
    expect(untouched!.deletedAt).toBeNull();
    expect(untouched!.primaryGuestEmail).toBe("guest@example.com");
  });

  it("is idempotent — a second run processes nothing", async () => {
    const past = new Date(Date.now() - 1000);
    await seedStay(past);
    await runRetentionCleanup({ db, storage });
    const secondRun = await runRetentionCleanup({ db, storage });
    expect(secondRun.deletedSubmissionIds).toEqual([]);
  });

  it("dry-run reports IDs without touching data", async () => {
    const past = new Date(Date.now() - 1000);
    const { stay } = await seedStay(past);
    const result = await runRetentionCleanup({ db, storage }, new Date(), { dryRun: true });
    expect(result.deletedSubmissionIds).toEqual([stay.id]);

    // Nothing actually wiped.
    const untouched = await db.guestSubmission.findUnique({ where: { id: stay.id } });
    expect(untouched!.deletedAt).toBeNull();
    expect(untouched!.primaryGuestEmail).toBe("guest@example.com");
  });
});
