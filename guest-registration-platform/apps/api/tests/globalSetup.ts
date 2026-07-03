import { execSync } from "node:child_process";
import path from "node:path";
import { TEST_DATABASE_URL } from "./testEnv.js";

/** Pushes the Prisma schema to the dedicated test database once per run. */
export default function globalSetup(): void {
  const dbPackageDir = path.resolve(process.cwd(), "../../packages/db");
  execSync("pnpm exec prisma db push --skip-generate --accept-data-loss", {
    cwd: dbPackageDir,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
