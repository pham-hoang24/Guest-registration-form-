import { getDb, disconnectDb } from "@gr/db";
import { storageProviderFromEnv } from "@gr/storage";
import { runRetentionCleanup } from "./retention.js";

const result = await runRetentionCleanup({
  db: getDb(),
  storage: storageProviderFromEnv(),
});
console.log(`Retention cleanup deleted ${result.deletedSubmissionIds.length} submission(s).`);
await disconnectDb();
