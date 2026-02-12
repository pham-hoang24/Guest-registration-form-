import { describe, expect, it } from "vitest";
import { buildAad, decryptPdf, encryptPdf, generateDek } from "../src/services/crypto.js";

describe("crypto", () => {
  it("roundtrips with correct AAD", () => {
    const dek = generateDek();
    const aad = buildAad({
      tenantId: "t1",
      propertyId: "p1",
      submissionId: "s1",
      schemaVersion: 1,
      aadVersion: 1
    });
    const plaintext = Buffer.from("hello");
    const encrypted = encryptPdf(plaintext, aad, dek);
    const decrypted = decryptPdf(encrypted.ciphertext, aad, dek, encrypted.nonce, encrypted.tag);
    expect(decrypted.toString("utf8")).toBe("hello");
  });

  it("fails with wrong AAD", () => {
    const dek = generateDek();
    const aad = buildAad({
      tenantId: "t1",
      propertyId: "p1",
      submissionId: "s1",
      schemaVersion: 1,
      aadVersion: 1
    });
    const wrongAad = buildAad({
      tenantId: "t1",
      propertyId: "p2",
      submissionId: "s1",
      schemaVersion: 1,
      aadVersion: 1
    });
    const plaintext = Buffer.from("hello");
    const encrypted = encryptPdf(plaintext, aad, dek);
    expect(() => decryptPdf(encrypted.ciphertext, wrongAad, dek, encrypted.nonce, encrypted.tag)).toThrow();
  });

  it("rejects invalid nonce length", () => {
    const dek = generateDek();
    const aad = buildAad({
      tenantId: "t1",
      propertyId: "p1",
      submissionId: "s1",
      schemaVersion: 1,
      aadVersion: 1
    });
    const plaintext = Buffer.from("hello");
    const encrypted = encryptPdf(plaintext, aad, dek);
    const badNonce = Buffer.alloc(8, 0);
    expect(() => decryptPdf(encrypted.ciphertext, aad, dek, badNonce, encrypted.tag)).toThrow(
      /Invalid nonce length/
    );
  });
});
