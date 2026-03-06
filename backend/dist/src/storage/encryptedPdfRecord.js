import { AAD_VERSION } from "../crypto/aad.js";
import { CRYPTO_VERSION, NONCE_LENGTH, TAG_LENGTH } from "../crypto/aesgcm.js";
import { canonicalizeJson } from "../crypto/aad.js";
export const ENCRYPTED_PDF_RECORD_VERSION = 1;
export const parseEncryptedPdfRecord = (input) => {
    if (!input || typeof input !== "object") {
        throw new Error("Invalid encrypted PDF record");
    }
    const record = input;
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
    return record;
};
export const serializeEncryptedPdfRecord = (record) => {
    return canonicalizeJson(record);
};
const assertBase64Length = (value, expected, label) => {
    if (!value) {
        throw new Error(`Missing ${label}`);
    }
    const buffer = Buffer.from(value, "base64");
    if (buffer.length !== expected) {
        throw new Error(`Invalid ${label} length`);
    }
};
const assertBase64 = (value, label) => {
    if (!value) {
        throw new Error(`Missing ${label}`);
    }
    Buffer.from(value, "base64");
};
