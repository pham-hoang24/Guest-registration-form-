import { writeAudit } from "@gr/db";
import type { WorkerDeps } from "./deps.js";

export type RetentionResult = {
  deletedSubmissionIds: string[];
};

/**
 * Retention cleanup: for every submission past its deleteAfter date that has not
 * yet been purged (deletedAt is null), wipe PII and mark it purged.
 *
 * Pass `{ dryRun: true }` to preview which submissions would be affected without
 * making any mutations to the DB or blob storage.
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
      deletedAt: null,
    },
    include: {
      passengerCards: {
        include: {
          guests: { select: { id: true } },
          signature: { select: { id: true } },
          encryptedPdf: { select: { id: true, blobPath: true } },
        },
      },
    },
  });

  const deletedSubmissionIds: string[] = [];

  for (const submission of expired) {
    if (dryRun) {
      deletedSubmissionIds.push(submission.id);
      continue;
    }

    // Wipe credential fields on all guests + remove each card's encrypted PDF.
    for (const card of submission.passengerCards) {
      if (card.encryptedPdf) {
        await storage.deleteObject({ path: card.encryptedPdf.blobPath });
        await db.encryptedPdf.delete({ where: { id: card.encryptedPdf.id } });
      }

      for (const guest of card.guests) {
        await db.guest.update({
          where: { id: guest.id },
          data: {
            documentNumberEncrypted: null,
            finnishPersonalIdentityCodeEncrypted: null,
            email: null,
            phoneE164: null,
          },
        });
      }

      // Wipe signature after PDF is no longer needed.
      if (card.signature) {
        await db.passengerCardSignature.update({
          where: { id: card.signature.id },
          data: { signatureEncrypted: null },
        });
      }
    }

    // Wipe stay-level contact info and soft-delete.
    await db.guestSubmission.update({
      where: { id: submission.id },
      data: {
        deletedAt: now,
        primaryGuestName: null,
        primaryGuestEmail: null,
        primaryGuestPhoneE164: null,
      },
    });

    await writeAudit(db, {
      tenantId: submission.tenantId,
      actorType: "SYSTEM",
      action: "RETENTION_DELETED_SUBMISSION",
      resourceType: "GuestSubmission",
      resourceId: submission.id,
      metadata: { deleteAfter: submission.deleteAfter?.toISOString() ?? "" },
    });

    deletedSubmissionIds.push(submission.id);
  }

  return { deletedSubmissionIds };
}
