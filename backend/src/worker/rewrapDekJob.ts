import { randomUUID } from "node:crypto";
import type { EncryptedPdfRecord } from "../storage/encryptedPdfRecord.js";
import { writeAudit } from "../services/audit.js";
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

export const rewrapDekJob = async (input: RewrapJobInput, adapter: KekAdapter) => {
  const correlationId = randomUUID();
  // TODO: iterate over records in DB or storage by KEK metadata.
  // TODO: implement optimistic concurrency using record version/etag.
  // TODO: persist updated record only when changed.
  writeAudit("dek_rewrapped", {
    correlationId,
    actorType: "system",
    actorId: "rewrap-job",
    details: {
      oldKekKeyId: input.oldKekKeyId,
      oldKekKeyVersion: input.oldKekKeyVersion,
      newKekKeyId: input.newKekKeyId,
      newKekKeyVersion: input.newKekKeyVersion
    }
  });
  void adapter;
};
