import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { LocalKmsProvider, encryptString } from "@gr/crypto";
import { PrismaClient, createRegistrationLinkWithStay } from "@gr/db";
import { LocalStorageProvider } from "@gr/storage";
import { generatePdfForPassengerCard } from "../src/generatePdfForPassengerCard.js";

const db = new PrismaClient();
const kms = new LocalKmsProvider(Buffer.alloc(32, 5).toString("base64"));
const storage = new LocalStorageProvider(mkdtempSync(path.join(tmpdir(), "gr-pdf-worker-test-")));
const deps = { db, kms, storage, storageProviderName: "local" };

// 8×8 opaque-black RGBA PNG — decodable by pdf-lib.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEUlEQVR4nGNgYGD4TwCPBAUAgkg/weiby3kAAAAASUVORK5CYII=";

async function truncateAll() {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "PdfJob", "PassengerCardSignature", "PassengerCard", ' +
      '"EncryptedPdf", "Guest", "GuestSubmission", ' +
      '"RegistrationLink", "Property", "OwnerUser", "Tenant" CASCADE',
  );
}

/** Seeds a stay + one primary (with spouse & child) card + one additional-adult card. */
async function seed() {
  const tenant = await db.tenant.create({ data: { name: "T" } });
  const property = await db.property.create({
    data: {
      tenantId: tenant.id,
      name: "Cabin",
      addressLine1: "Street 1",
      postalCode: "33100",
      city: "Tampere",
      countryCode: "FI",
      businessId: "1234567-8",
    },
  });
  const { stay } = await createRegistrationLinkWithStay(db, {
    tenantId: tenant.id,
    propertyId: property.id,
    tokenHash: `hash-${randomUUID()}`,
    arrivalDate: new Date("2026-07-20"),
    departureDate: new Date("2026-07-23"),
    purposeOfStay: "Leisure",
  });

  const makeSignature = async (cardId: string) =>
    encryptString({
      plaintext: PNG_B64,
      context: {
        tenantId: tenant.id,
        propertyId: property.id,
        guestSubmissionId: stay.id,
        passengerCardId: cardId,
        guestId: cardId,
        field: "signature",
      },
      kms,
    });

  const makeDoc = async (cardId: string, guestId: string) =>
    encryptString({
      plaintext: "X1234567",
      context: {
        tenantId: tenant.id,
        propertyId: property.id,
        guestSubmissionId: stay.id,
        passengerCardId: cardId,
        guestId,
        field: "documentNumber",
      },
      kms,
    });

  // Card 1: primary + spouse + minor child.
  const card1 = randomUUID();
  const holder1 = randomUUID();
  await db.passengerCard.create({
    data: {
      id: card1,
      guestSubmissionId: stay.id,
      tenantId: tenant.id,
      propertyId: property.id,
      cardNumber: 1,
      cardType: "PRIMARY_WITH_ALLOWED_FAMILY",
      countryOfEntryToFinland: "SE",
      submissionFingerprint: `fp1-${randomUUID()}`,
      requirementVersion: "FI-ACCOMMODATION-2026-01",
      guests: {
        create: [
          {
            id: holder1,
            tenantId: tenant.id,
            propertyId: property.id,
            guestType: "primary",
            roleOnCard: "CARD_HOLDER",
            firstName: "Nguyễn",
            lastName: "Åström",
            dateOfBirth: new Date("1990-04-12"),
            citizenship: "DE",
            isResidentInFinland: false,
            address: "Example Street 1",
            documentType: "passport",
            documentNumberEncrypted: await makeDoc(card1, holder1),
            email: "guest@example.com",
            isAdult: true,
          },
          {
            tenantId: tenant.id,
            propertyId: property.id,
            guestType: "spouse",
            roleOnCard: "SPOUSE",
            firstName: "Ben",
            lastName: "Åström",
            dateOfBirth: new Date("1991-02-02"),
            isAdult: true,
          },
          {
            tenantId: tenant.id,
            propertyId: property.id,
            guestType: "child",
            roleOnCard: "MINOR_CHILD",
            firstName: "Cara",
            lastName: "Åström",
            dateOfBirth: new Date("2018-05-05"),
            isAdult: false,
          },
        ],
      },
      signature: {
        create: {
          tenantId: tenant.id,
          propertyId: property.id,
          signatureEncrypted: await makeSignature(card1),
          signatureSha256: "aaaa".repeat(16),
        },
      },
      pdfJob: {
        create: { tenantId: tenant.id, propertyId: property.id, status: "PENDING" },
      },
    },
  });

  // Card 2: additional adult (own card).
  const card2 = randomUUID();
  const holder2 = randomUUID();
  await db.passengerCard.create({
    data: {
      id: card2,
      guestSubmissionId: stay.id,
      tenantId: tenant.id,
      propertyId: property.id,
      cardNumber: 2,
      cardType: "ADDITIONAL_ADULT_INDIVIDUAL",
      countryOfEntryNotApplicableReason: "NORDIC_CITIZEN",
      submissionFingerprint: `fp2-${randomUUID()}`,
      requirementVersion: "FI-ACCOMMODATION-2026-01",
      guests: {
        create: [
          {
            id: holder2,
            tenantId: tenant.id,
            propertyId: property.id,
            guestType: "additional_adult",
            roleOnCard: "CARD_HOLDER",
            firstName: "Dora",
            lastName: "Extra",
            dateOfBirth: new Date("1988-01-01"),
            citizenship: "SE",
            isResidentInFinland: false,
            address: "Extra Street 1",
            documentType: "passport",
            documentNumberEncrypted: await makeDoc(card2, holder2),
            email: "dora@example.com",
            isAdult: true,
          },
        ],
      },
      signature: {
        create: {
          tenantId: tenant.id,
          propertyId: property.id,
          signatureEncrypted: await makeSignature(card2),
          signatureSha256: "bbbb".repeat(16),
        },
      },
      pdfJob: {
        create: { tenantId: tenant.id, propertyId: property.id, status: "PENDING" },
      },
    },
  });

  return { tenant, property, stay, card1, card2 };
}

beforeEach(truncateAll);
afterAll(async () => {
  await db.$disconnect();
});

describe("generatePdfForPassengerCard", () => {
  it("generates one encrypted PDF per card, linked to the card and batch", async () => {
    const { tenant, property, stay, card1, card2 } = await seed();

    await generatePdfForPassengerCard(
      { tenantId: tenant.id, propertyId: property.id, passengerCardId: card1 },
      deps,
    );
    await generatePdfForPassengerCard(
      { tenantId: tenant.id, propertyId: property.id, passengerCardId: card2 },
      deps,
    );

    const pdf1 = await db.encryptedPdf.findUnique({ where: { passengerCardId: card1 } });
    const pdf2 = await db.encryptedPdf.findUnique({ where: { passengerCardId: card2 } });
    expect(pdf1).not.toBeNull();
    expect(pdf2).not.toBeNull();
    expect(pdf1!.batchId).toBe(stay.id);
    expect(pdf2!.batchId).toBe(stay.id);

    // Distinct blobs per card, both present in storage.
    expect(pdf1!.blobPath).not.toBe(pdf2!.blobPath);
    expect(pdf1!.blobPath).toContain(card1);
    const storedBlob = await storage.getObject({ path: pdf1!.blobPath });
    expect(storedBlob).toBeDefined();
    // Invariant 1: only ciphertext hits storage — the blob must NOT be a plaintext PDF.
    expect(storedBlob.subarray(0, 5).toString("ascii")).not.toBe("%PDF-");

    // AAD binds ciphertext to both the batch and the specific card.
    const aad1 = JSON.parse(pdf1!.aadJson);
    expect(aad1.passengerCardId).toBe(card1);
    expect(aad1.guestSubmissionId).toBe(stay.id);
    expect(aad1.schemaVersion).toBe("encrypted-passenger-card-pdf-v1");

    // Card + job status transitions.
    const c1 = await db.passengerCard.findUnique({ where: { id: card1 } });
    const j1 = await db.pdfJob.findUnique({ where: { passengerCardId: card1 } });
    expect(c1!.status).toBe("PDF_READY");
    expect(j1!.status).toBe("COMPLETED");

    // Batch stay is untouched (stays OPEN for further submissions).
    const s = await db.guestSubmission.findUnique({ where: { id: stay.id } });
    expect(s!.status).toBe("OPEN");
  });

  it("marks the card FAILED when the card has no signature", async () => {
    const { tenant, property, card1 } = await seed();
    await db.passengerCardSignature.update({
      where: { passengerCardId: card1 },
      data: { signatureEncrypted: null },
    });

    await expect(
      generatePdfForPassengerCard(
        { tenantId: tenant.id, propertyId: property.id, passengerCardId: card1 },
        deps,
      ),
    ).rejects.toThrow();

    const c1 = await db.passengerCard.findUnique({ where: { id: card1 } });
    const j1 = await db.pdfJob.findUnique({ where: { passengerCardId: card1 } });
    expect(c1!.status).toBe("FAILED");
    expect(j1!.status).toBe("FAILED");
    expect(await db.encryptedPdf.findUnique({ where: { passengerCardId: card1 } })).toBeNull();
  });
});
