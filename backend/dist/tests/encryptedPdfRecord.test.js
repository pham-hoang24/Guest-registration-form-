import { describe, expect, it } from "vitest";
import { parseEncryptedPdfRecord, ENCRYPTED_PDF_RECORD_VERSION } from "../src/storage/encryptedPdfRecord.js";
import { CRYPTO_VERSION, NONCE_LENGTH, TAG_LENGTH } from "../src/crypto/aesgcm.js";
import { AAD_VERSION } from "../src/crypto/aad.js";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const nonce = Buffer.alloc(NONCE_LENGTH).toString("base64"); // 12 bytes
const tag = Buffer.alloc(TAG_LENGTH).toString("base64"); // 16 bytes
const wrappedDek = Buffer.alloc(32).toString("base64"); // any base64
const sha256 = "a".repeat(64); // 64-char hex
function validRecord() {
    return {
        recordVersion: ENCRYPTED_PDF_RECORD_VERSION,
        cryptoVersion: CRYPTO_VERSION,
        aadVersion: AAD_VERSION,
        submissionId: "sub-1",
        tenantId: "tenant-1",
        propertyId: "prop-1",
        templateId: "default",
        templateVersion: 1,
        pdfSchemaVersion: "1",
        blobPath: "tenant/t/property/p/submission/s.pdf.enc",
        contentType: "application/pdf",
        contentLength: 1024,
        nonceB64: nonce,
        tagB64: tag,
        wrappedDekB64: wrappedDek,
        kekKeyId: "https://kv/keys/kek/v1",
        kekKeyVersion: "v1",
        ciphertextSha256Hex: sha256,
        createdAt: new Date().toISOString(),
        status: "READY",
        attemptCount: 0
    };
}
// ---------------------------------------------------------------------------
// Accept valid records
// ---------------------------------------------------------------------------
describe("parseEncryptedPdfRecord — valid records", () => {
    it("accepts a fully valid record", () => {
        const r = parseEncryptedPdfRecord(validRecord());
        expect(r.submissionId).toBe("sub-1");
        expect(r.tenantId).toBe("tenant-1");
        expect(r.recordVersion).toBe(ENCRYPTED_PDF_RECORD_VERSION);
    });
    it("accepts optional aadSha256Hex when 64 hex chars", () => {
        const r = parseEncryptedPdfRecord({ ...validRecord(), aadSha256Hex: sha256 });
        expect(r.aadSha256Hex).toBe(sha256);
    });
    it("accepts optional lastError: null", () => {
        const r = parseEncryptedPdfRecord({ ...validRecord(), lastError: null });
        expect(r.lastError).toBeNull();
    });
    it("accepts PENDING_PDF and FAILED statuses", () => {
        expect(parseEncryptedPdfRecord({ ...validRecord(), status: "PENDING_PDF" }).status).toBe("PENDING_PDF");
        expect(parseEncryptedPdfRecord({ ...validRecord(), status: "FAILED" }).status).toBe("FAILED");
    });
});
// ---------------------------------------------------------------------------
// Reject invalid records
// ---------------------------------------------------------------------------
describe("parseEncryptedPdfRecord — invalid records", () => {
    it("rejects null", () => {
        expect(() => parseEncryptedPdfRecord(null)).toThrow();
    });
    it("rejects non-object", () => {
        expect(() => parseEncryptedPdfRecord("string")).toThrow();
        expect(() => parseEncryptedPdfRecord(42)).toThrow();
    });
    it("rejects wrong recordVersion", () => {
        expect(() => parseEncryptedPdfRecord({ ...validRecord(), recordVersion: 99 })).toThrow("Invalid recordVersion");
    });
    it("rejects wrong cryptoVersion", () => {
        expect(() => parseEncryptedPdfRecord({ ...validRecord(), cryptoVersion: "bad" })).toThrow("Invalid cryptoVersion");
    });
    it("rejects wrong aadVersion", () => {
        expect(() => parseEncryptedPdfRecord({ ...validRecord(), aadVersion: 99 })).toThrow("Invalid aadVersion");
    });
    it("rejects missing submissionId", () => {
        const rec = validRecord();
        delete rec.submissionId;
        expect(() => parseEncryptedPdfRecord(rec)).toThrow("Missing identifiers");
    });
    it("rejects missing tenantId", () => {
        const rec = validRecord();
        delete rec.tenantId;
        expect(() => parseEncryptedPdfRecord(rec)).toThrow("Missing identifiers");
    });
    it("rejects missing propertyId", () => {
        const rec = validRecord();
        delete rec.propertyId;
        expect(() => parseEncryptedPdfRecord(rec)).toThrow("Missing identifiers");
    });
    it("rejects missing templateId", () => {
        const rec = validRecord();
        delete rec.templateId;
        expect(() => parseEncryptedPdfRecord(rec)).toThrow("Missing template metadata");
    });
    it("rejects missing pdfSchemaVersion", () => {
        const rec = validRecord();
        delete rec.pdfSchemaVersion;
        expect(() => parseEncryptedPdfRecord(rec)).toThrow("Missing template metadata");
    });
    it("rejects non-number templateVersion", () => {
        expect(() => parseEncryptedPdfRecord({ ...validRecord(), templateVersion: "1" })).toThrow("Missing templateVersion");
    });
    it("rejects missing blobPath", () => {
        const rec = validRecord();
        delete rec.blobPath;
        expect(() => parseEncryptedPdfRecord(rec)).toThrow("Missing blobPath");
    });
    it("rejects wrong contentType", () => {
        expect(() => parseEncryptedPdfRecord({ ...validRecord(), contentType: "image/png" })).toThrow("Invalid contentType");
    });
    it("rejects zero contentLength", () => {
        expect(() => parseEncryptedPdfRecord({ ...validRecord(), contentLength: 0 })).toThrow("Invalid contentLength");
    });
    it("rejects negative contentLength", () => {
        expect(() => parseEncryptedPdfRecord({ ...validRecord(), contentLength: -1 })).toThrow("Invalid contentLength");
    });
    it("rejects nonce with wrong byte length", () => {
        const shortNonce = Buffer.alloc(8).toString("base64"); // 8 bytes, not 12
        expect(() => parseEncryptedPdfRecord({ ...validRecord(), nonceB64: shortNonce })).toThrow("Invalid nonceB64 length");
    });
    it("rejects tag with wrong byte length", () => {
        const shortTag = Buffer.alloc(8).toString("base64"); // 8 bytes, not 16
        expect(() => parseEncryptedPdfRecord({ ...validRecord(), tagB64: shortTag })).toThrow("Invalid tagB64 length");
    });
    it("rejects missing wrappedDekB64", () => {
        const rec = validRecord();
        delete rec.wrappedDekB64;
        expect(() => parseEncryptedPdfRecord(rec)).toThrow("Missing wrappedDekB64");
    });
    it("rejects missing kekKeyId", () => {
        const rec = validRecord();
        delete rec.kekKeyId;
        expect(() => parseEncryptedPdfRecord(rec)).toThrow("Missing KEK metadata");
    });
    it("rejects missing kekKeyVersion", () => {
        const rec = validRecord();
        delete rec.kekKeyVersion;
        expect(() => parseEncryptedPdfRecord(rec)).toThrow("Missing KEK metadata");
    });
    it("rejects ciphertextSha256Hex shorter than 64 chars", () => {
        expect(() => parseEncryptedPdfRecord({ ...validRecord(), ciphertextSha256Hex: "abc" })).toThrow("Invalid ciphertextSha256Hex");
    });
    it("rejects aadSha256Hex shorter than 64 chars when present", () => {
        expect(() => parseEncryptedPdfRecord({ ...validRecord(), aadSha256Hex: "abc" })).toThrow("Invalid aadSha256Hex");
    });
    it("rejects missing createdAt", () => {
        const rec = validRecord();
        delete rec.createdAt;
        expect(() => parseEncryptedPdfRecord(rec)).toThrow("Missing createdAt");
    });
    it("rejects missing status", () => {
        const rec = validRecord();
        delete rec.status;
        expect(() => parseEncryptedPdfRecord(rec)).toThrow("Missing status");
    });
    it("rejects negative attemptCount", () => {
        expect(() => parseEncryptedPdfRecord({ ...validRecord(), attemptCount: -1 })).toThrow("Invalid attemptCount");
    });
    it("rejects non-number attemptCount", () => {
        expect(() => parseEncryptedPdfRecord({ ...validRecord(), attemptCount: "0" })).toThrow("Invalid attemptCount");
    });
});
