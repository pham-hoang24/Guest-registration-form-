import { execSync } from "node:child_process";
import path from "node:path";
import { TEST_DATABASE_URL } from "./testEnv.js";

/**
 * Partial unique indexes can't be expressed in schema.prisma, so `db push`
 * never creates them — they live only in migration SQL. Re-apply them here so
 * the test DB faithfully mirrors the migrated production schema (otherwise the
 * "one ACTIVE link per property" guarantee silently vanishes under test).
 */
const MIGRATION_ONLY_SQL = [
  'CREATE UNIQUE INDEX IF NOT EXISTS "registration_link_one_active_per_property" ' +
    'ON "RegistrationLink"("propertyId") WHERE "status" = \'ACTIVE\';',
].join("\n");

/** Pushes the Prisma schema to the dedicated test database once per run. */
export default function globalSetup(): void {
  const dbPackageDir = path.resolve(process.cwd(), "../../packages/db");
  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL };
  execSync("pnpm exec prisma db push --skip-generate --accept-data-loss", {
    cwd: dbPackageDir,
    stdio: "inherit",
    env,
  });
  execSync(`pnpm exec prisma db execute --url "${TEST_DATABASE_URL}" --stdin`, {
    cwd: dbPackageDir,
    input: MIGRATION_ONLY_SQL,
    stdio: ["pipe", "inherit", "inherit"],
    env,
  });
}
