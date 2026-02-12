import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const DEK_LENGTH = 32;
export const NONCE_LENGTH = 12;
export const TAG_LENGTH = 16;
export const CRYPTO_VERSION = "AES-256-GCM";

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

export const generateDek = () => randomBytes(DEK_LENGTH);

export type EncryptResult = {
  nonce: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
};

export const encryptAesGcm = (plaintext: Buffer, aad: Buffer, dek: Buffer): EncryptResult => {
  if (dek.length !== DEK_LENGTH) {
    throw new CryptoError("Invalid DEK length");
  }
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", dek, nonce);
  cipher.setAAD(aad, { plaintextLength: plaintext.length });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_LENGTH) {
    throw new CryptoError("Invalid auth tag length");
  }
  return { nonce, ciphertext, tag };
};

export const decryptAesGcm = (
  ciphertext: Buffer,
  aad: Buffer,
  dek: Buffer,
  nonce: Buffer,
  tag: Buffer
) => {
  if (dek.length !== DEK_LENGTH) {
    throw new CryptoError("Invalid DEK length");
  }
  if (nonce.length !== NONCE_LENGTH) {
    throw new CryptoError("Invalid nonce length");
  }
  if (tag.length !== TAG_LENGTH) {
    throw new CryptoError("Invalid auth tag length");
  }
  const decipher = createDecipheriv("aes-256-gcm", dek, nonce);
  decipher.setAAD(aad, { plaintextLength: ciphertext.length });
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext;
};
