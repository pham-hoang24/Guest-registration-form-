import type { SubmissionStatus } from "../types.js";
import { AAD_VERSION } from "../crypto/aad.js";
import { CRYPTO_VERSION, NONCE_LENGTH, TAG_LENGTH } from "../crypto/aesgcm.js";
import { canonicalizeJson } from "../crypto/aad.js";

export const ENCRYPTED_PDF_RECORD_VERSION = 1 as const;

export type EncryptedPdfRecord = {
  recordVersion: typeof ENCRYPTED_PDF_RECORD_VERSION;
  cryptoVersion: typeof CRYPTO_VERSION;
  aadVersion: typeof AAD_VERSION;
  submissionId: string;
  tenantId: string;
  propertyId: string;
  templateId: string;
  templateVersion: number;
  pdfSchemaVersion: string;
  blobPath: string;
  contentType: "application/pdf";
  contentLength: number;
  nonceB64: string;
  tagB64: string;
  wrappedDekB64: string;
  kekKeyId: string;
  kekKeyVersion: string;
  ciphertextSha256Hex: string;
  aadSha256Hex?: string;
  createdAt: string;
  status: SubmissionStatus;
  attemptCount: number;
  lastError?: string | null;
};

export const parseEncryptedPdfRecord = (input: unknown): EncryptedPdfRecord => {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid encrypted PDF record");
  }
  const record = input as Partial<EncryptedPdfRecord>;
  if (record.recordVersion !== ENCRYPTED_PDF_RECORD_VERSION) {
    throw new Error("Invalid recordVersion");
  }
  if (record.cryptoVersion !== CRYPTO_VERSION) {
    throw new Error("Invalid cryptoVersion");
  }
  if (record.aadVersion !== AAD_VERSION) {
    throw new Error("Invalid aadVersion");
  }
  if (!record.submissionId || !record.tenantId || !record.propertyId) {
    throw new Error("Missing identifiers");
  }
  if (!record.templateId || !record.pdfSchemaVersion) {
    throw new Error("Missing template metadata");
  }
  if (typeof record.templateVersion !== "number") {
    throw new Error("Missing templateVersion");
  }
  if (!record.blobPath) {
    throw new Error("Missing blobPath");
  }
  if (record.contentType !== "application/pdf") {
    throw new Error("Invalid contentType");
  }
  if (typeof record.contentLength !== "number" || record.contentLength <= 0) {
    throw new Error("Invalid contentLength");
  }
  assertBase64Length(record.nonceB64, NONCE_LENGTH, "nonceB64");
  assertBase64Length(record.tagB64, TAG_LENGTH, "tagB64");
  assertBase64(record.wrappedDekB64, "wrappedDekB64");
  if (!record.kekKeyId || !record.kekKeyVersion) {
    throw new Error("Missing KEK metadata");
  }
  if (!record.ciphertextSha256Hex || record.ciphertextSha256Hex.length !== 64) {
    throw new Error("Invalid ciphertextSha256Hex");
  }
  if (record.aadSha256Hex && record.aadSha256Hex.length !== 64) {
    throw new Error("Invalid aadSha256Hex");
  }
  if (!record.createdAt) {
    throw new Error("Missing createdAt");
  }
  if (!record.status) {
    throw new Error("Missing status");
  }
  if (typeof record.attemptCount !== "number" || record.attemptCount < 0) {
    throw new Error("Invalid attemptCount");
  }
  return record as EncryptedPdfRecord;
};

export const serializeEncryptedPdfRecord = (record: EncryptedPdfRecord) => {
  return canonicalizeJson(record);
};

const assertBase64Length = (value: string | undefined, expected: number, label: string) => {
  if (!value) {
    throw new Error(`Missing ${label}`);
  }
  const buffer = Buffer.from(value, "base64");
  if (buffer.length !== expected) {
    throw new Error(`Invalid ${label} length`);
  }
};

const assertBase64 = (value: string | undefined, label: string) => {
  if (!value) {
    throw new Error(`Missing ${label}`);
  }
  Buffer.from(value, "base64");
};
