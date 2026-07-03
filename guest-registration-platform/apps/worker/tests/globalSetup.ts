import { execSync } from "node:child_process";
import path from "node:path";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5433/guest_registration_test";

export default function globalSetup(): void {
  const dbPackageDir = path.resolve(process.cwd(), "../../packages/db");
  execSync("pnpm exec prisma db push --skip-generate --accept-data-loss", {
    cwd: dbPackageDir,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
