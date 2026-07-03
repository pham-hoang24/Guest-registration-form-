import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { LocalKmsProvider, generateRegistrationToken, hashRegistrationToken } from "@gr/crypto";
import { PrismaClient, type OwnerRole } from "@gr/db";
import { LocalStorageProvider } from "@gr/storage";
import { buildApp } from "../src/app.js";
import { configFromEnv } from "../src/config.js";
import type { AppDeps } from "../src/deps.js";

/** Fixed 32-byte master key so all test components share one KMS. */
const TEST_KMS_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");

export const testDb = new PrismaClient();

export function buildTestDeps(): AppDeps {
  return {
    db: testDb,
    kms: new LocalKmsProvider(TEST_KMS_MASTER_KEY),
    storage: new LocalStorageProvider(mkdtempSync(path.join(tmpdir(), "gr-api-test-"))),
    storageProviderName: "local",
    config: configFromEnv({ ...process.env, NODE_ENV: "test" }),
  };
}

export function buildTestApp(): { app: Express; deps: AppDeps } {
  const deps = buildTestDeps();
  return { app: buildApp(deps), deps };
}

export async function truncateAll(): Promise<void> {
  await testDb.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "EncryptedPdf", "Guest", "GuestSubmission", ' +
      '"RegistrationLink", "Property", "OwnerUser", "Tenant" CASCADE',
  );
}

export type TestFixtures = Awaited<ReturnType<typeof seedFixtures>>;

/** Two tenants, users of every role in tenant A, a property + active link each. */
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
  const linkA = await testDb.registrationLink.create({
    data: {
      tenantId: tenantA.id,
      propertyId: propertyA.id,
      tokenHash: hashRegistrationToken(rawTokenA),
    },
  });

  const rawTokenB = generateRegistrationToken();
  const linkB = await testDb.registrationLink.create({
    data: {
      tenantId: tenantB.id,
      propertyId: propertyB.id,
      tokenHash: hashRegistrationToken(rawTokenB),
    },
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
    linkB,
    rawTokenA,
    rawTokenB,
    password: "test-password",
  };
}

export const validSubmissionBody = {
  arrivalDate: "2026-07-20",
  departureDate: "2026-07-23",
  purposeOfStay: "Leisure",
  guestEmail: "guest@example.com",
  guestPhone: "+358401234567",
  guests: [
    {
      firstName: "Anna",
      lastName: "Example",
      dateOfBirth: "1995-04-12",
      nationality: "FI",
      address: "Example Street 1, Helsinki",
      documentType: "passport",
      documentNumber: "X1234567",
      isPrimaryGuest: true,
    },
  ],
  privacyAccepted: true,
  accuracyConfirmed: true,
};
