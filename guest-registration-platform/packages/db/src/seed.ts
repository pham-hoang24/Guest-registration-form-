import bcrypt from "bcryptjs";
import { generateRegistrationToken, hashRegistrationToken } from "@gr/crypto";
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

  // A fresh token is generated on every seed run; only its hash is stored.
  const rawToken = generateRegistrationToken();
  await db.registrationLink.create({
    data: {
      tenantId: tenant.id,
      propertyId: property.id,
      tokenHash: hashRegistrationToken(rawToken),
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
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
