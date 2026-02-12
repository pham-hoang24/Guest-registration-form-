import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const generateDek = () => randomBytes(32);

export const buildAad = (parts: {
  tenantId: string;
  propertyId: string;
  submissionId: string;
  schemaVersion: number;
  aadVersion: number;
}) => {
  return Buffer.from(
    `${parts.tenantId}|${parts.propertyId}|${parts.submissionId}|${parts.schemaVersion}|${parts.aadVersion}`,
    "utf8"
  );
};

export const encryptPdf = (plaintext: Buffer, aad: Buffer, dek: Buffer) => {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dek, nonce);
  cipher.setAAD(aad, { plaintextLength: plaintext.length });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertextSha256 = createHash("sha256").update(ciphertext).digest("hex");
  return {
    ciphertext,
    nonce,
    tag,
    ciphertextSha256
  };
};

export const decryptPdf = (ciphertext: Buffer, aad: Buffer, dek: Buffer, nonce: Buffer, tag: Buffer) => {
  if (nonce.length !== 12) {
    throw new Error("Invalid nonce length");
  }
  const decipher = createDecipheriv("aes-256-gcm", dek, nonce);
  decipher.setAAD(aad, { plaintextLength: ciphertext.length });
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext;
};
