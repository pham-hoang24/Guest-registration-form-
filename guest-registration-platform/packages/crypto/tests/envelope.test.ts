import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  decryptPdf,
  encryptPdf,
  LocalKmsProvider,
  type EncryptionContext,
  type EncryptResult,
} from "../src/index.js";

const kms = new LocalKmsProvider(randomBytes(32).toString("base64"));

const context: EncryptionContext = {
  tenantId: "tenant-1",
  propertyId: "property-1",
  submissionId: "submission-1",
  requirementVersion: "FI-ACCOMMODATION-2026-01",
};

const plaintext = Buffer.from("%PDF-1.7 fake pdf bytes for testing", "utf8");

describe("envelope encryption", () => {
  let result: EncryptResult;

  beforeAll(async () => {
    result = await encryptPdf({ plaintext, context, kms });
  });

  it("round trips encrypt/decrypt", async () => {
    const decrypted = await decryptPdf({ ...result, kms, expectedContext: context });
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it("produces fresh DEK and IV per encryption", async () => {
    const second = await encryptPdf({ plaintext, context, kms });
    expect(second.encryptedDekBase64).not.toBe(result.encryptedDekBase64);
    expect(second.ivBase64).not.toBe(result.ivBase64);
    expect(second.ciphertext.equals(result.ciphertext)).toBe(false);
  });

  it("fails decryption with wrong AAD (context mismatch)", async () => {
    const wrongContext = { ...context, tenantId: "tenant-2" };
    await expect(
      decryptPdf({ ...result, kms, expectedContext: wrongContext }),
    ).rejects.toThrow(/AAD mismatch/);
  });

  it("fails decryption when stored AAD bytes are tampered", async () => {
    const tamperedAad = result.aadJson.replace("tenant-1", "tenant-2");
    await expect(
      decryptPdf({ ...result, aadJson: tamperedAad, kms }),
    ).rejects.toThrow();
  });

  it("fails decryption with tampered ciphertext", async () => {
    const tampered = Buffer.from(result.ciphertext);
    tampered[0] = tampered[0]! ^ 0xff;
    await expect(
      decryptPdf({ ...result, ciphertext: tampered, kms, expectedContext: context }),
    ).rejects.toThrow();
  });

  it("fails decryption with tampered auth tag", async () => {
    const tag = Buffer.from(result.authTagBase64, "base64");
    tag[0] = tag[0]! ^ 0xff;
    await expect(
      decryptPdf({
        ...result,
        authTagBase64: tag.toString("base64"),
        kms,
        expectedContext: context,
      }),
    ).rejects.toThrow();
  });

  it("fails to unwrap the DEK with a different master key", async () => {
    const otherKms = new LocalKmsProvider(randomBytes(32).toString("base64"));
    await expect(
      decryptPdf({ ...result, kms: otherKms, expectedContext: context }),
    ).rejects.toThrow();
  });

  it("records ciphertext sha256 for integrity checks", () => {
    expect(result.sha256Ciphertext).toMatch(/^[0-9a-f]{64}$/);
    expect(result.algorithm).toBe("AES-256-GCM");
  });
});
