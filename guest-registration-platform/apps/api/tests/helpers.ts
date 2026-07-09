import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { LocalKmsProvider, generateRegistrationToken, hashRegistrationToken } from "@gr/crypto";
import { PrismaClient, type OwnerRole, createRegistrationLinkWithStay } from "@gr/db";
import type { QueueProducer, PdfJobMessage } from "@gr/queue";
import { LocalStorageProvider } from "@gr/storage";
import { buildApp } from "../src/app.js";
import { configFromEnv } from "../src/config.js";
import type { AppDeps } from "../src/deps.js";

/** Fixed 32-byte master key so all test components share one KMS. */
const TEST_KMS_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");

export const testDb = new PrismaClient();

/**
 * Records enqueued PDF jobs without running the worker inline, so submit tests
 * can assert one job per card while PDF generation stays decoupled (the worker
 * is exercised directly in its own tests). Reset between tests via truncateAll.
 */
export class RecordingQueueProducer implements QueueProducer {
  public readonly messages: PdfJobMessage[] = [];
  async enqueuePdfJob(message: PdfJobMessage): Promise<void> {
    this.messages.push(message);
  }
}

export const testQueue = new RecordingQueueProducer();

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
    queue: testQueue,
    config: configFromEnv({ ...process.env, NODE_ENV: "test" }),
  };
}

export function buildTestApp(): { app: Express; deps: AppDeps } {
  const deps = buildTestDeps();
  return { app: buildApp(deps), deps };
}

/** Builds a test app with env overrides applied on top of process.env (e.g. OWNER_JWKS_URI). */
export function buildTestAppWithEnv(envOverrides: NodeJS.ProcessEnv): { app: Express; deps: AppDeps } {
  const deps: AppDeps = {
    ...buildTestDeps(),
    config: configFromEnv({ ...process.env, NODE_ENV: "test", ...envOverrides }),
  };
  return { app: buildApp(deps), deps };
}

const OWNER_COOKIE_NAME = "gr_owner_session";

/** Extracts the raw session cookie value (the JWT) from a login response's Set-Cookie. */
export function extractSessionCookie(
  res: { headers: Record<string, unknown> },
  cookieName: string = OWNER_COOKIE_NAME,
): string {
  const setCookie = res.headers["set-cookie"];
  const cookies = Array.isArray(setCookie) ? setCookie : [];
  const raw = cookies.find((c) => c.startsWith(`${cookieName}=`));
  if (!raw) throw new Error(`${cookieName} cookie was not set`);
  return raw.split(";")[0]!.slice(cookieName.length + 1);
}

export async function truncateAll(): Promise<void> {
  testQueue.messages.length = 0;
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

/** 8×8 opaque-black RGBA PNG — genuinely decodable by pdf-lib (worker embeds it). */
const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEUlEQVR4nGNgYGD4TwCPBAUAgkg/weiby3kAAAAASUVORK5CYII=",
  "base64",
);

export type MultipartSubmissionOptions = {
  arrivalDate?: string;
  departureDate?: string;
  departureDateKnown?: boolean;
  purposeOfStay?: string;
  /** Extra or missing signature fields for negative testing. */
  signatureFields?: Record<string, Buffer>;
  additionalAdultCount?: number;
  /** Overrides for the primary card holder (e.g. residency / citizenship). */
  primaryOverrides?: Record<string, unknown>;
  /** Overrides applied to every additional adult (e.g. phone). */
  additionalAdultOverrides?: Record<string, unknown>;
};

/**
 * Builds a valid multipart submission request body with a single primary guest
 * plus optionally N additional adults. Returns the payload and signature buffers
 * as a record for use with supertest's `.attach()` and `.field()`.
 */
export function buildMultipartSubmission(opts: MultipartSubmissionOptions = {}) {
  const {
    arrivalDate = "2026-07-20",
    departureDateKnown = true,
    purposeOfStay = "Leisure",
    additionalAdultCount = 0,
    primaryOverrides = {},
    additionalAdultOverrides = {},
  } = opts;
  // Distinguish "not passed" (default date) from an explicit `undefined` (omit it),
  // so callers can build a departureDateKnown:true payload with no date.
  const departureDate = "departureDate" in opts ? opts.departureDate : "2026-07-23";

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
      documentNumber: "X1234567",
      ...primaryOverrides,
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
      documentNumber: `Y000000${i}`,
      ...additionalAdultOverrides,
    });
  }

  const payload = JSON.stringify({
    arrivalDate,
    ...(departureDateKnown && departureDate ? { departureDate } : {}),
    departureDateKnown,
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
