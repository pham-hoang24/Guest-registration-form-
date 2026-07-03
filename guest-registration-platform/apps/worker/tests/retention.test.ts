import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { LocalKmsProvider, encryptString } from "@gr/crypto";
import { PrismaClient } from "@gr/db";
import { LocalStorageProvider } from "@gr/storage";
import { generatePdfForSubmission } from "../src/generatePdfForSubmission.js";
import { runRetentionCleanup } from "../src/retention.js";

const db = new PrismaClient();
const kms = new LocalKmsProvider(Buffer.alloc(32, 9).toString("base64"));
const storage = new LocalStorageProvider(mkdtempSync(path.join(tmpdir(), "gr-worker-test-")));

async function truncateAll() {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "EncryptedPdf", "Guest", "GuestSubmission", ' +
      '"RegistrationLink", "Property", "OwnerUser", "Tenant" CASCADE',
  );
}

async function seedSubmission(deleteAfter: Date) {
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
  const link = await db.registrationLink.create({
    data: { tenantId: tenant.id, propertyId: property.id, tokenHash: `hash-${Date.now()}` },
  });
  const submission = await db.guestSubmission.create({
    data: {
      tenantId: tenant.id,
      propertyId: property.id,
      registrationLinkId: link.id,
      arrivalDate: new Date("2026-07-20"),
      departureDate: new Date("2026-07-23"),
      purposeOfStay: "Leisure",
      requirementVersion: "FI-ACCOMMODATION-2026-01",
      guestEmail: "guest@example.com",
      guestPhone: "+358401234567",
      retainUntil: deleteAfter,
      deleteAfter,
    },
  });
  await db.guest.create({
    data: {
      submissionId: submission.id,
      firstName: "Anna",
      lastName: "Example",
      dateOfBirth: new Date("1995-04-12"),
      nationality: "FI",
      address: "Example Street 1",
      documentType: "passport",
      documentNumberEncrypted: await encryptString({
        plaintext: "X1234567",
        context: { submissionId: submission.id, field: "documentNumber" },
        kms,
      }),
      isPrimaryGuest: true,
    },
  });
  return { tenant, property, submission };
}

beforeEach(truncateAll);

afterAll(async () => {
  await db.$disconnect();
});

describe("generatePdfForSubmission", () => {
  it("creates an encrypted PDF record and marks the submission PDF_READY", async () => {
    const { tenant, property, submission } = await seedSubmission(new Date("2099-01-01"));
    await generatePdfForSubmission(
      { tenantId: tenant.id, propertyId: property.id, submissionId: submission.id },
      { db, kms, storage, storageProviderName: "local" },
    );

    const updated = await db.guestSubmission.findFirst({
      where: { id: submission.id, tenantId: tenant.id },
      include: { encryptedPdf: true },
    });
    expect(updated!.status).toBe("PDF_READY");
    expect(updated!.encryptedPdf).not.toBeNull();

    // Stored blob is ciphertext, not a PDF.
    const blob = await storage.getObject({ path: updated!.encryptedPdf!.blobPath });
    expect(blob.subarray(0, 5).toString("ascii")).not.toBe("%PDF-");
  });

  it("refuses a wrong tenant scope", async () => {
    const { property, submission } = await seedSubmission(new Date("2099-01-01"));
    await expect(
      generatePdfForSubmission(
        { tenantId: "wrong-tenant", propertyId: property.id, submissionId: submission.id },
        { db, kms, storage, storageProviderName: "local" },
      ),
    ).rejects.toThrow(/not found/i);
  });
});

describe("runRetentionCleanup", () => {
  it("deletes expired submissions' PII, PDFs and blobs, and audits it", async () => {
    const past = new Date(Date.now() - 1000);
    const { tenant, property, submission } = await seedSubmission(past);
    await generatePdfForSubmission(
      { tenantId: tenant.id, propertyId: property.id, submissionId: submission.id },
      { db, kms, storage, storageProviderName: "local" },
    );
    const blobPath = (await db.encryptedPdf.findFirst({
      where: { submissionId: submission.id },
    }))!.blobPath;

    const result = await runRetentionCleanup({ db, storage });
    expect(result.deletedSubmissionIds).toEqual([submission.id]);

    const cleaned = await db.guestSubmission.findFirst({
      where: { id: submission.id, tenantId: tenant.id },
      include: { guests: true, encryptedPdf: true },
    });
    expect(cleaned!.status).toBe("DELETED");
    expect(cleaned!.guestEmail).toBeNull();
    expect(cleaned!.guestPhone).toBeNull();
    expect(cleaned!.guests).toHaveLength(0);
    expect(cleaned!.encryptedPdf).toBeNull();
    await expect(storage.getObject({ path: blobPath })).rejects.toThrow();

    const audit = await db.auditLog.findFirst({
      where: { action: "RETENTION_DELETED_SUBMISSION", resourceId: submission.id },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorType).toBe("SYSTEM");
  });

  it("leaves unexpired submissions untouched", async () => {
    const { tenant, submission } = await seedSubmission(new Date("2099-01-01"));
    const result = await runRetentionCleanup({ db, storage });
    expect(result.deletedSubmissionIds).toEqual([]);
    const untouched = await db.guestSubmission.findFirst({
      where: { id: submission.id, tenantId: tenant.id },
      include: { guests: true },
    });
    expect(untouched!.status).toBe("RECEIVED");
    expect(untouched!.guests).toHaveLength(1);
  });

  it("is idempotent — a second run deletes nothing", async () => {
    const past = new Date(Date.now() - 1000);
    await seedSubmission(past);
    await runRetentionCleanup({ db, storage });
    const secondRun = await runRetentionCleanup({ db, storage });
    expect(secondRun.deletedSubmissionIds).toEqual([]);
  });
});
