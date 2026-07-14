import bcrypt from "bcryptjs";
import { generateRegistrationToken, hashRegistrationToken } from "@gr/crypto";
import { REQUIREMENT_VERSION } from "@gr/shared";
import { getDb, disconnectDb } from "./index.js";

const OWNER_EMAIL = "owner@example.com";
const OWNER_PASSWORD = "owner-dev-password";
const VIEWER_EMAIL = "viewer@example.com";
const VIEWER_PASSWORD = "viewer-dev-password";

async function main() {
  const db = getDb();
  const publicAppUrl = process.env.PUBLIC_APP_URL ?? "http://localhost:5173";

  const tenant = await db.tenant.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Demo Host Oy",
      status: "ACTIVE",
    },
  });

  await db.ownerUser.upsert({
    where: { email: OWNER_EMAIL },
    update: {},
    create: {
      tenantId: tenant.id,
      email: OWNER_EMAIL,
      passwordHash: await bcrypt.hash(OWNER_PASSWORD, 12),
      role: "OWNER",
      status: "ACTIVE",
    },
  });

  await db.ownerUser.upsert({
    where: { email: VIEWER_EMAIL },
    update: {},
    create: {
      tenantId: tenant.id,
      email: VIEWER_EMAIL,
      passwordHash: await bcrypt.hash(VIEWER_PASSWORD, 12),
      role: "VIEWER",
      status: "ACTIVE",
    },
  });

  const property = await db.property.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      tenantId: tenant.id,
      name: "Example Cabin",
      addressLine1: "Example Street 1",
      postalCode: "33100",
      city: "Tampere",
      countryCode: "FI",
      businessId: "1234567-8",
    },
  });

  // At most one ACTIVE link per property (enforced by a partial unique index).
  // Revoke any prior active link so repeated seed runs stay idempotent.
  await db.registrationLink.updateMany({
    where: { propertyId: property.id, status: "ACTIVE" },
    data: { status: "REVOKED" },
  });

  // Retire any prior OPEN stays so a repeated seed leaves exactly one live one.
  await db.guestSubmission.updateMany({
    where: { propertyId: property.id, status: "OPEN" },
    data: { status: "EXPIRED" },
  });

  // A fresh token is generated on every seed run; only its hash is stored.
  const rawToken = generateRegistrationToken();
  const link = await db.registrationLink.create({
    data: {
      tenantId: tenant.id,
      propertyId: property.id,
      tokenHash: hashRegistrationToken(rawToken),
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });

  // The active link is only usable once it has an OPEN stay to submit into
  // (see resolveActiveLink in apps/api). Mirror the owner regenerate endpoint.
  const arrival = new Date();
  const departure = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  await db.guestSubmission.create({
    data: {
      tenantId: tenant.id,
      propertyId: property.id,
      registrationLinkId: link.id,
      status: "OPEN",
      arrivalDate: new Date(
        `${arrival.toISOString().slice(0, 10)}T00:00:00Z`,
      ),
      departureDate: new Date(
        `${departure.toISOString().slice(0, 10)}T00:00:00Z`,
      ),
      departureDateKnown: true,
      purposeOfStay: null,
      requirementVersion: REQUIREMENT_VERSION,
      maxPassengerCards: 20,
      legalBasis: "LEGAL_OBLIGATION",
    },
  });

  console.log("Seed complete.");
  console.log("");
  console.log(`Owner login:  ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
  console.log(`Viewer login: ${VIEWER_EMAIL} / ${VIEWER_PASSWORD}`);
  console.log("");
  console.log("Registration URL (raw token shown ONCE, only the hash is stored):");
  console.log(`  ${publicAppUrl}/registration/${rawToken}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
