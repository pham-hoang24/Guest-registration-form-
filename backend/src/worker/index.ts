import { randomUUID } from "node:crypto";
import { db } from "../services/db.js";
import { generatePdf } from "../services/pdf.js";
import { buildAad, encryptPdf, generateDek } from "../services/crypto.js";
import { wrapDekWithKeyVault } from "../services/keyVault.js";
import { storage } from "../services/storage.js";
import { writeAudit } from "../services/audit.js";

type SubmissionJob = {
  submissionId: string;
  payload: Record<string, unknown>;
};

const maxAttempts = Number(process.env.WORKER_MAX_ATTEMPTS || 5);

export const processSubmissionJob = async (job: SubmissionJob) => {
  const correlationId = randomUUID();
  const submission = db.getSubmission(job.submissionId);
  if (!submission) return;

  if (submission.status === "READY") {
    return;
  }

  if (submission.attemptCount >= maxAttempts) {
    db.setStatus(submission.id, "FAILED", "max_attempts_exceeded");
    writeAudit("submission_failed", {
      correlationId,
      actorType: "system",
      actorId: "worker",
      tenantId: submission.tenantId,
      propertyId: submission.propertyId,
      submissionId: submission.id,
      details: { reason: "max_attempts_exceeded" }
    });
    return;
  }

  db.updateSubmission(submission.id, { attemptCount: submission.attemptCount + 1 });

  const blobPath = `tenant/${submission.tenantId}/property/${submission.propertyId}/submission/${submission.id}.pdf.enc`;
  const exists = await storage.exists(blobPath);
  if (exists) {
    db.updateSubmission(submission.id, { status: "READY", blobPath });
    return;
  }

  try {
    writeAudit("pdf_generated", {
      correlationId,
      actorType: "system",
      actorId: "worker",
      tenantId: submission.tenantId,
      propertyId: submission.propertyId,
      submissionId: submission.id
    });

    const pdfBuffer = await generatePdf(job.payload);
    const dek = generateDek();
    const aad = buildAad({
      tenantId: submission.tenantId,
      propertyId: submission.propertyId,
      submissionId: submission.id,
      schemaVersion: submission.schemaVersion,
      aadVersion: submission.aadVersion
    });

    const encrypted = encryptPdf(pdfBuffer, aad, dek);
    const wrapped = await wrapDekWithKeyVault(dek);

    await storage.put(blobPath, encrypted.ciphertext, "application/pdf");

    db.setEncryptionMetadata({
      submissionId: submission.id,
      tenantId: submission.tenantId,
      propertyId: submission.propertyId,
      algo: "AES-256-GCM",
      nonce: encrypted.nonce.toString("base64"),
      tag: encrypted.tag.toString("base64"),
      ciphertextSha256: encrypted.ciphertextSha256,
      contentType: "application/pdf",
      contentLength: encrypted.ciphertext.length,
      aadVersion: submission.aadVersion,
      schemaVersion: submission.schemaVersion
    });

    db.updateSubmission(submission.id, {
      status: "READY",
      blobPath,
      wrappedDek: wrapped.wrappedDek,
      kekKeyId: wrapped.keyId,
      kekKeyVersion: wrapped.keyVersion
    });

    writeAudit("pdf_encrypted", {
      correlationId,
      actorType: "system",
      actorId: "worker",
      tenantId: submission.tenantId,
      propertyId: submission.propertyId,
      submissionId: submission.id
    });
    writeAudit("dek_wrapped", {
      correlationId,
      actorType: "system",
      actorId: "worker",
      tenantId: submission.tenantId,
      propertyId: submission.propertyId,
      submissionId: submission.id,
      details: { keyId: wrapped.keyId, keyVersion: wrapped.keyVersion }
    });
    writeAudit("pdf_ready", {
      correlationId,
      actorType: "system",
      actorId: "worker",
      tenantId: submission.tenantId,
      propertyId: submission.propertyId,
      submissionId: submission.id
    });
  } catch (error) {
    db.setStatus(submission.id, "FAILED", (error as Error).message);
    writeAudit("submission_failed", {
      correlationId,
      actorType: "system",
      actorId: "worker",
      tenantId: submission.tenantId,
      propertyId: submission.propertyId,
      submissionId: submission.id,
      details: { reason: (error as Error).message }
    });
  }
};
