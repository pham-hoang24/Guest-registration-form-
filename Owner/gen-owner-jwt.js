#!/usr/bin/env node
/**
 * scripts/gen-owner-jwt.js
 *
 * Generates a signed owner JWT for local development.
 *
 * Usage:
 *   node scripts/gen-owner-jwt.js
 *   node scripts/gen-owner-jwt.js --sub owner-123 --tenantId tenant-abc --propertyIds prop-1,prop-2
 *
 * Options:
 *   --sub          Owner subject/ID   (default: "dev-owner")
 *   --tenantId     Tenant ID          (default: "dev-tenant")
 *   --propertyIds  Comma-separated    (default: "prop-1,prop-2")
 *   --expiresIn    JWT expiry         (default: "7d")
 *   --secret       Signing secret     (default: OWNER_JWT_SECRET env var or "dev-secret")
 *
 * Output:
 *   Prints the JWT to stdout so you can copy it into:
 *     • VITE_DEV_OWNER_TOKEN in .env
 *     • The "Paste owner JWT" field on the login page
 */

const { execSync } = require("child_process");

// Ensure jsonwebtoken is available
try {
  require.resolve("jsonwebtoken");
} catch {
  console.error(
    "\n  ⚠  jsonwebtoken is not installed.\n" +
      "  Run:  npm install --save-dev jsonwebtoken\n"
  );
  process.exit(1);
}

const jwt = require("jsonwebtoken");

// ---------------------------------------------------------------------------
// Parse CLI args (no external deps)
// ---------------------------------------------------------------------------

function arg(flag, defaultValue) {
  const idx = process.argv.indexOf(`--${flag}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return defaultValue;
}

const sub = arg("sub", "dev-owner");
const tenantId = arg("tenantId", "dev-tenant");
const propertyIdsRaw = arg("propertyIds", "prop-1,prop-2");
const expiresIn = arg("expiresIn", "7d");
const secret =
  arg("secret", null) || process.env.OWNER_JWT_SECRET || "dev-secret";

const propertyIds = propertyIdsRaw
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ---------------------------------------------------------------------------
// Sign token
// ---------------------------------------------------------------------------

const payload = {
  sub,
  tenantId,
  propertyIds,
};

const token = jwt.sign(payload, secret, { expiresIn });

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

console.log("\n✅  Owner JWT generated\n");
console.log("Token:");
console.log("─".repeat(60));
console.log(token);
console.log("─".repeat(60));
console.log("\nPayload:");
console.log(JSON.stringify(payload, null, 2));
console.log(`\nExpires in: ${expiresIn}`);
console.log(
  `\nTo use in dev, add to your .env:\n  VITE_DEV_OWNER_TOKEN=${token}\n`
);
