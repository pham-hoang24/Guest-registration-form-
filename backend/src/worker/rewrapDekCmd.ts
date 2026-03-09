/**
 * rewrapDekCmd — privileged CLI tool for DEK key rotation.
 *
 * Usage:
 *   node dist/worker/rewrapDekCmd.js \
 *     --old-key-id      <full Key Vault key URI>  \
 *     --old-key-version <version hex>             \
 *     --new-key-id      <full Key Vault key URI>  \
 *     --new-key-version <version hex>             \
 *     [--dry-run]
 *
 * Requires env vars: KEYVAULT_URL, KEK_KEY_NAME (and optionally KEK_KEY_VERSION).
 *
 * SECURITY: This binary must only be invoked by authenticated operators
 * (e.g. via Azure CLI, CI/CD pipeline with managed identity, or an admin
 * API protected by OIDC/RBAC). Never expose it as a public endpoint.
 * Do NOT run two instances of this job concurrently — concurrent runs produce
 * split audit trails and misleading totalChanged / totalFailed counts. Use an
 * advisory lock (Azure Blob lease, Azure Redis, or a DB-level lock) if
 * concurrent execution is possible in your environment.
 *
 * Exit codes:
 *   0 — completed with totalFailed === 0
 *   1 — completed with totalFailed > 0, or bad arguments, or startup error
 */

import { parseArgs } from "node:util";
import { db } from "../services/db.js";
import { rewrapDekJob, type RewrapJobInput } from "./rewrapDekJob.js";
import { KeyVaultKekAdapter } from "../crypto/keyVaultKek.js";

const PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "old-key-id": { type: "string" },
    "old-key-version": { type: "string" },
    "new-key-id": { type: "string" },
    "new-key-version": { type: "string" },
    "dry-run": { type: "boolean", default: false }
  },
  strict: true
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const missing: string[] = [];
if (!values["old-key-id"]) missing.push("--old-key-id");
if (!values["new-key-id"]) missing.push("--new-key-id");

if (missing.length > 0) {
  console.error(`[rewrapDekCmd] Missing required arguments: ${missing.join(", ")}`);
  console.error(
    "Usage: node dist/worker/rewrapDekCmd.js " +
      "--old-key-id <uri> [--old-key-version <v>] " +
      "--new-key-id <uri> [--new-key-version <v>] [--dry-run]"
  );
  process.exit(1);
}

/**
 * Validates a Key Vault key ID string:
 * - Non-empty and within reasonable length
 * - No newlines or carriage returns (log-injection guard)
 * - Must be an HTTPS URI pointing to *.vault.azure.net (rejects file://, arbitrary URLs, etc.)
 */
const assertSafeKeyId = (value: string, label: string): void => {
  if (!value || value.length === 0) {
    console.error(`[rewrapDekCmd] ${label} must not be empty`);
    process.exit(1);
  }
  if (value.length > 512) {
    console.error(`[rewrapDekCmd] ${label} exceeds maximum length`);
    process.exit(1);
  }
  if (/[\r\n]/.test(value)) {
    console.error(`[rewrapDekCmd] ${label} contains invalid characters`);
    process.exit(1);
  }
  if (!value.startsWith("https://") || !value.includes(".vault.azure.net/")) {
    console.error(
      `[rewrapDekCmd] ${label} does not look like a valid Azure Key Vault key URI ` +
        "(expected: https://<vault>.vault.azure.net/keys/<name>[/<version>])"
    );
    process.exit(1);
  }
};

assertSafeKeyId(values["old-key-id"]!, "--old-key-id");
assertSafeKeyId(values["new-key-id"]!, "--new-key-id");
if (values["old-key-version"]) assertSafeKeyId(values["old-key-version"], "--old-key-version");
if (values["new-key-version"]) assertSafeKeyId(values["new-key-version"], "--new-key-version");

// Guard: old and new must not be the same key+version.
// If both ID and version are identical, rewrapRecord silently skips all records
// (idempotent-skip path) and reports success — a silent no-op the operator
// would not expect.
const oldKeyId = values["old-key-id"]!;
const oldKeyVersion = values["old-key-version"] ?? "";
const newKeyId = values["new-key-id"]!;
const newKeyVersion = values["new-key-version"] ?? "";

if (oldKeyId === newKeyId && oldKeyVersion === newKeyVersion) {
  console.error(
    "[rewrapDekCmd] --old-key-id/version and --new-key-id/version are identical. " +
      "The job would silently skip all records. Provide a different target key."
  );
  process.exit(1);
}

const isDryRun = values["dry-run"] === true;

// ---------------------------------------------------------------------------
// Initialise Key Vault adapter (before dry-run so config errors are caught early)
// ---------------------------------------------------------------------------

let adapter: KeyVaultKekAdapter;
try {
  adapter = KeyVaultKekAdapter.fromEnv();
} catch (err) {
  console.error(
    "[rewrapDekCmd] Failed to initialise Key Vault adapter:",
    err instanceof Error ? err.message : err
  );
  process.exit(1);
}

const input: RewrapJobInput = {
  oldKekKeyId: oldKeyId,
  oldKekKeyVersion: values["old-key-version"],
  newKekKeyId: newKeyId,
  newKekKeyVersion: values["new-key-version"]
};

// ---------------------------------------------------------------------------
// Dry-run: verify DB connectivity and count matching records — no writes made
// ---------------------------------------------------------------------------

if (isDryRun) {
  console.log("[rewrapDekCmd] DRY RUN — verifying connectivity and counting records...");
  console.log("[rewrapDekCmd] Key Vault adapter initialised OK.");
  console.log("[rewrapDekCmd] Job parameters:", {
    oldKekKeyId: input.oldKekKeyId,
    oldKekKeyVersion: input.oldKekKeyVersion ?? "(latest)",
    newKekKeyId: input.newKekKeyId,
    newKekKeyVersion: input.newKekKeyVersion ?? "(latest)"
  });

  try {
    let count = 0;
    let offset = 0;

    while (true) {
      const page = await db.getEncryptedPdfRecordsByKek(
        input.oldKekKeyId,
        input.oldKekKeyVersion,
        { offset, limit: PAGE_SIZE }
      );
      if (page.length === 0) break;
      count += page.length;
      offset += PAGE_SIZE;
    }

    console.log(`[rewrapDekCmd] DRY RUN complete. DB reachable. ${count} record(s) would be processed.`);
  } catch (err) {
    console.error(
      "[rewrapDekCmd] DRY RUN failed — could not query database:",
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  }

  process.exit(0);
}

// ---------------------------------------------------------------------------
// Live run
// ---------------------------------------------------------------------------

console.log("[rewrapDekCmd] Starting DEK rewrap job...");

try {
  const result = await rewrapDekJob(input, adapter);

  console.log("[rewrapDekCmd] Rewrap complete:", result);

  if (result.totalFailed > 0) {
    console.error(
      `[rewrapDekCmd] ${result.totalFailed} record(s) failed — inspect audit log for details. ` +
        "Re-run the job once the underlying issue is resolved (it is idempotent)."
    );
    process.exit(1);
  }

  process.exit(0);
} catch (err) {
  // Unexpected top-level error (e.g. DB unreachable during pagination)
  console.error(
    "[rewrapDekCmd] Fatal error during rewrap job:",
    err instanceof Error ? err.message : err
  );
  process.exit(1);
}
