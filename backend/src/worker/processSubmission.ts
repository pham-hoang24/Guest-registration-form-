import { randomUUID } from "node:crypto";
import { db } from "../services/db.js";
import { storage } from "../services/storage.js";
import { writeAudit } from "../services/audit.js";
import { DEFAULT_TEMPLATE_ID, DEFAULT_TEMPLATE_VERSION, generatePdf } from "../services/pdf.js";
import { buildAadBytes } from "../crypto/aad.js";
import { CRYPTO_VERSION, encryptAesGcm, generateDek } from "../crypto/aesgcm.js";
import { hashNonceCiphertextTagHex, sha256Hex, timingSafeEqualHex } from "../crypto/hashes.js";
import { AAD_VERSION } from "../crypto/aad.js";
import type { KekAdapter } from "../crypto/keyVaultKek.js";
import { KeyVaultKekAdapter } from "../crypto/keyVaultKek.js";
import type { RegistrationSubmission } from "../pdf/types.js";
import { ENCRYPTED_PDF_RECORD_VERSION, type EncryptedPdfRecord } from "../storage/encryptedPdfRecord.js";

type TemplateRef = {
  templateId: string;
  templateVersion: number;
};

type SubmissionJob = {
  submissionId: string;
  payload: RegistrationSubmission;
  templateRef?: TemplateRef;
};

const maxAttempts = Number(process.env.WORKER_MAX_ATTEMPTS || 5);
let kekAdapter: KekAdapter | null = null;

const getKekAdapter = () => {
  if (!kekAdapter) {
    kekAdapter = KeyVaultKekAdapter.fromEnv();
  }
  return kekAdapter;
};

export const setKekAdapterForTests = (adapter: KekAdapter) => {
  kekAdapter = adapter;
};

export const processSubmissionJob = async (job: SubmissionJob) => {
  const correlationId = randomUUID();
  const submissionResult = db.getSubmissionWithVersion(job.submissionId);
  if (!submissionResult) return;
  const { submission, version } = submissionResult;

  if (submission.status === "READY") return;

  if (submission.status === "FAILED" && submission.attemptCount >= maxAttempts) {
    return;
  }

  const existingRecord = db.getEncryptedPdfRecord(submission.id);
  if (existingRecord) {
    const isReady = await verifyExistingRecord(existingRecord);
    if (isReady) {
      db.compareAndSwapSubmission(submission.id, version, { status: "READY" });
      return;
    }
  }

  try {
    const templateRef = job.templateRef ?? {
      templateId: DEFAULT_TEMPLATE_ID,
      templateVersion: DEFAULT_TEMPLATE_VERSION
    };
    const pdfResult = await generatePdf(job.payload, templateRef.templateId, templateRef.templateVersion);
    const dek = generateDek();
    const aadBytes = buildAadBytes({
      tenantId: submission.tenantId,
      propertyId: submission.propertyId,
      submissionId: submission.id,
      templateId: pdfResult.templateId,
      templateVersion: pdfResult.templateVersion,
      pdfSchemaVersion: pdfResult.pdfSchemaVersion,
      cryptoVersion: CRYPTO_VERSION
    });
    const aadSha256Hex = sha256Hex(aadBytes);
    const { nonce, ciphertext, tag } = encryptAesGcm(pdfResult.pdfBytes, aadBytes, dek);
    const ciphertextSha256Hex = hashNonceCiphertextTagHex(nonce, ciphertext, tag);
    const wrapped = await getKekAdapter().wrapDek(dek);

    const blobPath = `tenant/${submission.tenantId}/property/${submission.propertyId}/submission/${submission.id}.pdf.enc`;
    await storage.put(blobPath, ciphertext, "application/octet-stream");

    const record: EncryptedPdfRecord = {
      recordVersion: ENCRYPTED_PDF_RECORD_VERSION,
      cryptoVersion: CRYPTO_VERSION,
      aadVersion: AAD_VERSION,
      submissionId: submission.id,
      tenantId: submission.tenantId,
      propertyId: submission.propertyId,
      templateId: pdfResult.templateId,
      templateVersion: pdfResult.templateVersion,
      pdfSchemaVersion: pdfResult.pdfSchemaVersion,
      blobPath,
      contentType: pdfResult.contentType,
      contentLength: pdfResult.contentLength,
      nonceB64: nonce.toString("base64"),
      tagB64: tag.toString("base64"),
      wrappedDekB64: wrapped.wrappedDek.toString("base64"),
      kekKeyId: wrapped.kekKeyId,
      kekKeyVersion: wrapped.kekKeyVersion,
      ciphertextSha256Hex,
      aadSha256Hex,
      createdAt: new Date().toISOString(),
      status: "READY",
      attemptCount: submission.attemptCount,
      lastError: null
    };

    db.setEncryptedPdfRecord(record);
    const latest = db.getSubmissionWithVersion(submission.id);
    if (latest) {
      db.compareAndSwapSubmission(submission.id, latest.version, {
        status: "READY",
        blobPath,
        wrappedDek: record.wrappedDekB64,
        kekKeyId: record.kekKeyId,
        kekKeyVersion: record.kekKeyVersion,
        contentHash: record.ciphertextSha256Hex
      });
    } else {
      db.updateSubmission(submission.id, {
      status: "READY",
      blobPath,
      wrappedDek: record.wrappedDekB64,
      kekKeyId: record.kekKeyId,
      kekKeyVersion: record.kekKeyVersion,
      contentHash: record.ciphertextSha256Hex
      });
    }

    writeAudit("pdf_ready", {
      correlationId,
      actorType: "system",
      actorId: "worker",
      tenantId: submission.tenantId,
      propertyId: submission.propertyId,
      submissionId: submission.id
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    const latest = db.getSubmissionWithVersion(submission.id);
    const updates = {
      status: "FAILED" as const,
      lastError: message,
      attemptCount: submission.attemptCount + 1
    };
    if (latest) {
      db.compareAndSwapSubmission(submission.id, latest.version, updates);
    } else {
      db.updateSubmission(submission.id, updates);
    }
    const recordWithVersion = db.getEncryptedPdfRecordWithVersion(submission.id);
    if (recordWithVersion) {
      db.compareAndSwapEncryptedPdfRecord(submission.id, recordWithVersion.version, {
        status: "FAILED",
        attemptCount: submission.attemptCount + 1,
        lastError: message
      });
    }
    writeAudit("submission_failed", {
      correlationId,
      actorType: "system",
      actorId: "worker",
      tenantId: submission.tenantId,
      propertyId: submission.propertyId,
      submissionId: submission.id,
      details: { reason: message }
    });
  }
};

export const processSubmissionToEncryptedPdf = async (
  submission: { id: string; tenantId: string; propertyId: string },
  payload: RegistrationSubmission,
  templateRef: TemplateRef
) => {
  const pdfResult = await generatePdf(payload, templateRef.templateId, templateRef.templateVersion);
  const dek = generateDek();
  const aadBytes = buildAadBytes({
    tenantId: submission.tenantId,
    propertyId: submission.propertyId,
    submissionId: submission.id,
    templateId: pdfResult.templateId,
    templateVersion: pdfResult.templateVersion,
    pdfSchemaVersion: pdfResult.pdfSchemaVersion,
    cryptoVersion: CRYPTO_VERSION
  });
  const aadSha256Hex = sha256Hex(aadBytes);
  const { nonce, ciphertext, tag } = encryptAesGcm(pdfResult.pdfBytes, aadBytes, dek);
  const ciphertextSha256Hex = hashNonceCiphertextTagHex(nonce, ciphertext, tag);
  const wrapped = await getKekAdapter().wrapDek(dek);
  const record: EncryptedPdfRecord = {
    recordVersion: ENCRYPTED_PDF_RECORD_VERSION,
    cryptoVersion: CRYPTO_VERSION,
    aadVersion: AAD_VERSION,
    submissionId: submission.id,
    tenantId: submission.tenantId,
    propertyId: submission.propertyId,
    templateId: pdfResult.templateId,
    templateVersion: pdfResult.templateVersion,
    pdfSchemaVersion: pdfResult.pdfSchemaVersion,
    blobPath: "",
    contentType: pdfResult.contentType,
    contentLength: pdfResult.contentLength,
    nonceB64: nonce.toString("base64"),
    tagB64: tag.toString("base64"),
    wrappedDekB64: wrapped.wrappedDek.toString("base64"),
    kekKeyId: wrapped.kekKeyId,
    kekKeyVersion: wrapped.kekKeyVersion,
    ciphertextSha256Hex,
    aadSha256Hex,
    createdAt: new Date().toISOString(),
    status: "READY",
    attemptCount: 0,
    lastError: null
  };
  return { record, ciphertextBytes: ciphertext };
};

const verifyExistingRecord = async (record: EncryptedPdfRecord) => {
  const blob = await storage.get(record.blobPath);
  if (!blob) return false;
  const nonce = Buffer.from(record.nonceB64, "base64");
  const tag = Buffer.from(record.tagB64, "base64");
  const hash = hashNonceCiphertextTagHex(nonce, blob.ciphertext, tag);
  return timingSafeEqualHex(hash, record.ciphertextSha256Hex);
};
