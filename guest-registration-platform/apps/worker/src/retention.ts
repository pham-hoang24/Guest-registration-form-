import { writeAudit } from "@gr/db";
import type { WorkerDeps } from "./deps.js";

export type RetentionResult = {
  deletedSubmissionIds: string[];
};

/**
 * Retention cleanup: for every submission past its deleteAfter date,
 * remove the encrypted PDF (blob + record), delete guest PII rows, clear
 * contact details, mark the submission DELETED and write an audit log.
 *
 * Pass `{ dryRun: true }` to preview which submissions would be affected
 * without making any mutations to the DB or blob storage.
 *
 * MVP: invoked manually (`pnpm --filter @gr/worker retention`) or from tests.
 * Production should run this on a schedule (cron / Azure Container Apps job).
 */
export async function runRetentionCleanup(
  deps: Pick<WorkerDeps, "db" | "storage">,
  now: Date = new Date(),
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<RetentionResult> {
  const { db, storage } = deps;

  const expired = await db.guestSubmission.findMany({
    where: {
      deleteAfter: { lte: now },
      status: { not: "DELETED" },
    },
    include: { encryptedPdf: true },
  });

  const deletedSubmissionIds: string[] = [];

  for (const submission of expired) {
    if (dryRun) {
      // Dry-run: report without touching any data.
      deletedSubmissionIds.push(submission.id);
      continue;
    }

    if (submission.encryptedPdf) {
      await storage.deleteObject({ path: submission.encryptedPdf.blobPath });
      await db.encryptedPdf.delete({ where: { id: submission.encryptedPdf.id } });
    }

    await db.guest.deleteMany({ where: { submissionId: submission.id } });

    await db.guestSubmission.update({
      where: { id: submission.id },
      data: {
        status: "DELETED",
        guestEmail: null,
        guestPhone: null,
      },
    });

    await writeAudit(db, {
      tenantId: submission.tenantId,
      actorType: "SYSTEM",
      action: "RETENTION_DELETED_SUBMISSION",
      resourceType: "GuestSubmission",
      resourceId: submission.id,
      metadata: { deleteAfter: submission.deleteAfter.toISOString() },
    });

    deletedSubmissionIds.push(submission.id);
  }

  return { deletedSubmissionIds };
}
