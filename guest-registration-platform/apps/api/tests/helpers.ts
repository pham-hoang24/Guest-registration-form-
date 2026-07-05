import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { LocalKmsProvider, generateRegistrationToken, hashRegistrationToken } from "@gr/crypto";
import { PrismaClient, type OwnerRole, createRegistrationLinkWithStay } from "@gr/db";
import { InProcessQueueProducer } from "@gr/queue";
import { LocalStorageProvider } from "@gr/storage";
import { generatePdfForSubmission } from "@gr/worker";
import { buildApp } from "../src/app.js";
import { configFromEnv } from "../src/config.js";
import type { AppDeps } from "../src/deps.js";

/** Fixed 32-byte master key so all test components share one KMS. */
const TEST_KMS_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");

export const testDb = new PrismaClient();

export function buildTestDeps(): AppDeps {
  const db = testDb;
  const kms = new LocalKmsProvider(TEST_KMS_MASTER_KEY);
  const storage = new LocalStorageProvider(mkdtempSync(path.join(tmpdir(), "gr-api-test-")));
  const storageProviderName = "local";
  return {
    db,
    kms,
    storage,
    storageProviderName,
    queue: new InProcessQueueProducer((msg) =>
      generatePdfForSubmission(msg, { db, kms, storage, storageProviderName }),
    ),
    config: configFromEnv({ ...process.env, NODE_ENV: "test" }),
  };
}

export function buildTestApp(): { app: Express; deps: AppDeps } {
  const deps = buildTestDeps();
  return { app: buildApp(deps), deps };
}

export async function truncateAll(): Promise<void> {
  await testDb.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "PdfJob", "PassengerCardSignature", "PassengerCard", ' +
      '"EncryptedPdf", "Guest", "GuestSubmission", ' +
      '"RegistrationLink", "Property", "OwnerUser", "Tenant" CASCADE',
  );
}

export type TestFixtures = Awaited<ReturnType<typeof seedFixtures>>;

/** Two tenants, users of every role in tenant A, a property + active link+stay each. */
export async function seedFixtures() {
  const passwordHash = await bcrypt.hash("test-password", 4);

  const tenantA = await testDb.tenant.create({ data: { name: "Tenant A" } });
  const tenantB = await testDb.tenant.create({ data: { name: "Tenant B" } });

  const makeUser = (tenantId: string, email: string, role: OwnerRole) =>
    testDb.ownerUser.create({ data: { tenantId, email, passwordHash, role } });

  const ownerA = await makeUser(tenantA.id, "owner-a@example.com", "OWNER");
  const managerA = await makeUser(tenantA.id, "manager-a@example.com", "MANAGER");
  const viewerA = await makeUser(tenantA.id, "viewer-a@example.com", "VIEWER");
  const ownerB = await makeUser(tenantB.id, "owner-b@example.com", "OWNER");

  const propertyA = await testDb.property.create({
    data: {
      tenantId: tenantA.id,
      name: "Cabin A",
      addressLine1: "Street 1",
      postalCode: "33100",
      city: "Tampere",
      countryCode: "FI",
      businessId: "1234567-8",
    },
  });
  const propertyB = await testDb.property.create({
    data: {
      tenantId: tenantB.id,
      name: "Cabin B",
      addressLine1: "Street 2",
      postalCode: "00100",
      city: "Helsinki",
      countryCode: "FI",
    },
  });

  const rawTokenA = generateRegistrationToken();
  const { link: linkA, stay: stayA } = await createRegistrationLinkWithStay(testDb, {
    tenantId: tenantA.id,
    propertyId: propertyA.id,
    tokenHash: hashRegistrationToken(rawTokenA),
    arrivalDate: new Date("2026-07-20"),
    departureDate: new Date("2026-07-23"),
    purposeOfStay: "Leisure",
  });

  const rawTokenB = generateRegistrationToken();
  const { link: linkB, stay: stayB } = await createRegistrationLinkWithStay(testDb, {
    tenantId: tenantB.id,
    propertyId: propertyB.id,
    tokenHash: hashRegistrationToken(rawTokenB),
    arrivalDate: new Date("2026-08-01"),
    departureDate: new Date("2026-08-05"),
    purposeOfStay: "Business",
  });

  return {
    tenantA,
    tenantB,
    ownerA,
    managerA,
    viewerA,
    ownerB,
    propertyA,
    propertyB,
    linkA,
    stayA,
    linkB,
    stayB,
    rawTokenA,
    rawTokenB,
    password: "test-password",
  };
}

/** Minimal valid PNG — 1×1 transparent pixel. */
const VALID_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6260000000020001e221bc330000000049454e44ae426082",
  "hex",
);

export type MultipartSubmissionOptions = {
  arrivalDate?: string;
  departureDate?: string;
  purposeOfStay?: string;
  /** Extra or missing signature fields for negative testing. */
  signatureFields?: Record<string, Buffer>;
  additionalAdultCount?: number;
};

/**
 * Builds a valid multipart submission request body with a single primary guest
 * plus optionally N additional adults. Returns the payload and signature buffers
 * as a record for use with supertest's `.attach()` and `.field()`.
 */
export function buildMultipartSubmission(opts: MultipartSubmissionOptions = {}) {
  const {
    arrivalDate = "2026-07-20",
    departureDate = "2026-07-23",
    purposeOfStay = "Leisure",
    additionalAdultCount = 0,
  } = opts;

  const people: object[] = [
    {
      guestType: "primary",
      firstName: "Anna",
      lastName: "Example",
      dateOfBirth: "1990-04-12",
      isResidentInFinland: false,
      citizenship: "DE",
      countryOfEntryToFinland: "SE",
      address: "Example Street 1, Helsinki",
      documentType: "passport",
      documentNumber: "X1234567",
      email: "guest@example.com",
    },
  ];

  for (let i = 0; i < additionalAdultCount; i++) {
    people.push({
      guestType: "additional_adult",
      firstName: `Adult${i}`,
      lastName: "Extra",
      dateOfBirth: "1988-01-01",
      isResidentInFinland: false,
      citizenship: "SE",
      address: "Extra Street 1",
      documentType: "passport",
      documentNumber: `Y000000${i}`,
      email: `adult${i}@example.com`,
    });
  }

  const payload = JSON.stringify({
    arrivalDate,
    departureDate,
    purposeOfStay,
    privacyAccepted: true,
    accuracyConfirmed: true,
    people,
  });

  // Signature files: one per expected card.
  const signatures: Record<string, Buffer> = opts.signatureFields ?? {};
  if (!opts.signatureFields) {
    signatures["signature_primary"] = VALID_PNG;
    for (let i = 0; i < additionalAdultCount; i++) {
      signatures[`signature_additionalAdult_${i}`] = VALID_PNG;
    }
  }

  return { payload, signatures };
}

export { VALID_PNG };
