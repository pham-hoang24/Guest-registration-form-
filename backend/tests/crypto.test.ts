import { describe, expect, it } from "vitest";
import { buildAadBytes } from "../src/crypto/aad.js";
import { decryptAesGcm, encryptAesGcm, generateDek } from "../src/crypto/aesgcm.js";
import { assertHashMatch, hashNonceCiphertextTagHex } from "../src/crypto/hashes.js";

describe("crypto", () => {
  it("roundtrips with correct AAD", () => {
    const dek = generateDek();
    const aad = buildAadBytes({
      tenantId: "t1",
      propertyId: "p1",
      submissionId: "s1",
      templateId: "default",
      templateVersion: 1,
      pdfSchemaVersion: "1.0",
      cryptoVersion: "AES-256-GCM"
    });
    const plaintext = Buffer.from("hello");
    const encrypted = encryptAesGcm(plaintext, aad, dek);
    const decrypted = decryptAesGcm(encrypted.ciphertext, aad, dek, encrypted.nonce, encrypted.tag);
    expect(decrypted.toString("utf8")).toBe("hello");
  });

  it("fails with wrong AAD", () => {
    const dek = generateDek();
    const aad = buildAadBytes({
      tenantId: "t1",
      propertyId: "p1",
      submissionId: "s1",
      templateId: "default",
      templateVersion: 1,
      pdfSchemaVersion: "1.0",
      cryptoVersion: "AES-256-GCM"
    });
    const wrongAad = buildAadBytes({
      tenantId: "t1",
      propertyId: "p2",
      submissionId: "s1",
      templateId: "default",
      templateVersion: 1,
      pdfSchemaVersion: "1.0",
      cryptoVersion: "AES-256-GCM"
    });
    const plaintext = Buffer.from("hello");
    const encrypted = encryptAesGcm(plaintext, aad, dek);
    expect(() =>
      decryptAesGcm(encrypted.ciphertext, wrongAad, dek, encrypted.nonce, encrypted.tag)
    ).toThrow();
  });

  it("rejects invalid nonce length", () => {
    const dek = generateDek();
    const aad = buildAadBytes({
      tenantId: "t1",
      propertyId: "p1",
      submissionId: "s1",
      templateId: "default",
      templateVersion: 1,
      pdfSchemaVersion: "1.0",
      cryptoVersion: "AES-256-GCM"
    });
    const plaintext = Buffer.from("hello");
    const encrypted = encryptAesGcm(plaintext, aad, dek);
    const badNonce = Buffer.alloc(8, 0);
    expect(() => decryptAesGcm(encrypted.ciphertext, aad, dek, badNonce, encrypted.tag)).toThrow(
      /Invalid nonce length/
    );
  });

  it("rejects tampered tag", () => {
    const dek = generateDek();
    const aad = buildAadBytes({
      tenantId: "t1",
      propertyId: "p1",
      submissionId: "s1",
      templateId: "default",
      templateVersion: 1,
      pdfSchemaVersion: "1.0",
      cryptoVersion: "AES-256-GCM"
    });
    const plaintext = Buffer.from("hello");
    const encrypted = encryptAesGcm(plaintext, aad, dek);
    const badTag = Buffer.from(encrypted.tag);
    badTag[0] ^= 0xff;
    expect(() => decryptAesGcm(encrypted.ciphertext, aad, dek, encrypted.nonce, badTag)).toThrow();
  });

  it("hashes nonce||ciphertext||tag consistently", () => {
    const dek = generateDek();
    const aad = buildAadBytes({
      tenantId: "t1",
      propertyId: "p1",
      submissionId: "s1",
      templateId: "default",
      templateVersion: 1,
      pdfSchemaVersion: "1.0",
      cryptoVersion: "AES-256-GCM"
    });
    const plaintext = Buffer.from("hello");
    const encrypted = encryptAesGcm(plaintext, aad, dek);
    const hash1 = hashNonceCiphertextTagHex(encrypted.nonce, encrypted.ciphertext, encrypted.tag);
    const hash2 = hashNonceCiphertextTagHex(encrypted.nonce, encrypted.ciphertext, encrypted.tag);
    expect(hash1).toBe(hash2);
  });

  it("detects ciphertext hash tampering", () => {
    const dek = generateDek();
    const aad = buildAadBytes({
      tenantId: "t1",
      propertyId: "p1",
      submissionId: "s1",
      templateId: "default",
      templateVersion: 1,
      pdfSchemaVersion: "1.0",
      cryptoVersion: "AES-256-GCM"
    });
    const plaintext = Buffer.from("hello");
    const encrypted = encryptAesGcm(plaintext, aad, dek);
    const hash = hashNonceCiphertextTagHex(encrypted.nonce, encrypted.ciphertext, encrypted.tag);
    const tampered = hash.replace(/^./, hash[0] === "a" ? "b" : "a");
    expect(() => assertHashMatch(hash, tampered, "Ciphertext hash")).toThrow(/Ciphertext hash/);
  });
});
