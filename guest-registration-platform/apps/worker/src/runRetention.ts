import { getDb, disconnectDb } from "@gr/db";
import { storageProviderFromEnv } from "@gr/storage";
import { runRetentionCleanup } from "./retention.js";

const dryRun = process.argv.includes("--dry-run");

const result = await runRetentionCleanup(
  { db: getDb(), storage: await storageProviderFromEnv() },
  new Date(),
  { dryRun },
);

if (dryRun) {
  console.log(`[dry-run] Would delete ${result.deletedSubmissionIds.length} submission(s):`);
  for (const id of result.deletedSubmissionIds) {
    console.log(`  ${id}`);
  }
} else {
  console.log(`Retention cleanup deleted ${result.deletedSubmissionIds.length} submission(s).`);
}
await disconnectDb();
