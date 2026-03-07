import { randomUUID } from "node:crypto";
import type { EncryptedPdfRecord } from "../storage/encryptedPdfRecord.js";
import { writeAudit } from "../services/audit.js";
import { db } from "../services/db.js";
import type { KekAdapter } from "../crypto/keyVaultKek.js";

type RewrapJobInput = {
  oldKekKeyId: string;
  oldKekKeyVersion?: string;
  newKekKeyId: string;
  newKekKeyVersion?: string;
};

export const rewrapRecord = async (
  record: EncryptedPdfRecord,
  adapter: KekAdapter,
  input: RewrapJobInput
) => {
  if (record.kekKeyId === input.newKekKeyId && record.kekKeyVersion === input.newKekKeyVersion) {
    return { record, changed: false };
  }
  if (record.kekKeyId !== input.oldKekKeyId) {
    return { record, changed: false };
  }
  const dek = await adapter.unwrapDek(
    Buffer.from(record.wrappedDekB64, "base64"),
    record.kekKeyId,
    record.kekKeyVersion
  );
  const wrapped = await adapter.wrapDek(dek);
  const updated: EncryptedPdfRecord = {
    ...record,
    wrappedDekB64: wrapped.wrappedDek.toString("base64"),
    kekKeyId: wrapped.kekKeyId,
    kekKeyVersion: wrapped.kekKeyVersion
  };
  return { record: updated, changed: true };
};

const PAGE_SIZE = 100;

export const rewrapDekJob = async (
  input: RewrapJobInput,
  adapter: KekAdapter
): Promise<{ totalRewrapped: number; totalSkipped: number }> => {
  const correlationId = randomUUID();
  let offset = 0;
  let totalRewrapped = 0;
  let totalSkipped = 0;

  writeAudit("dek_rewrapped", {
    correlationId,
    actorType: "system",
    actorId: "rewrap-job",
    details: {
      phase: "started",
      oldKekKeyId: input.oldKekKeyId,
      oldKekKeyVersion: input.oldKekKeyVersion,
      newKekKeyId: input.newKekKeyId,
      newKekKeyVersion: input.newKekKeyVersion
    }
  });

  while (true) {
    const page = await db.getEncryptedPdfRecordsByKek(
      input.oldKekKeyId,
      input.oldKekKeyVersion,
      { offset, limit: PAGE_SIZE }
    );

    if (page.length === 0) break;

    for (const { record, version } of page) {
      const { record: updated, changed } = await rewrapRecord(record, adapter, input);

      if (!changed) {
        totalSkipped++;
        continue;
      }

      const result = await db.compareAndSwapEncryptedPdfRecord(record.submissionId, version, {
        wrappedDekB64: updated.wrappedDekB64,
        kekKeyId: updated.kekKeyId,
        kekKeyVersion: updated.kekKeyVersion
      });

      if (result) {
        totalRewrapped++;
        writeAudit("dek_rewrapped", {
          correlationId,
          actorType: "system",
          actorId: "rewrap-job",
          tenantId: record.tenantId,
          submissionId: record.submissionId,
          details: {
            phase: "record_rewrapped",
            oldKekKeyId: input.oldKekKeyId,
            oldKekKeyVersion: input.oldKekKeyVersion,
            newKekKeyId: updated.kekKeyId,
            newKekKeyVersion: updated.kekKeyVersion
          }
        });
      } else {
        // CAS conflict: another process updated this record concurrently — skip it.
        // It will either be picked up on the next run or was already rewrapped.
        totalSkipped++;
      }
    }

    offset += PAGE_SIZE;
  }

  writeAudit("dek_rewrapped", {
    correlationId,
    actorType: "system",
    actorId: "rewrap-job",
    details: {
      phase: "completed",
      oldKekKeyId: input.oldKekKeyId,
      newKekKeyId: input.newKekKeyId,
      totalRewrapped,
      totalSkipped
    }
  });

  return { totalRewrapped, totalSkipped };
};
