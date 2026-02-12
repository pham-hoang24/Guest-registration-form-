import { buildAadBytes } from "../crypto/aad.js";
import { decryptAesGcm, encryptAesGcm, generateDek } from "../crypto/aesgcm.js";
import { hashNonceCiphertextTagHex } from "../crypto/hashes.js";

export { generateDek, buildAadBytes };

export const encryptPdf = (plaintext: Buffer, aad: Buffer, dek: Buffer) => {
  const { nonce, ciphertext, tag } = encryptAesGcm(plaintext, aad, dek);
  return {
    ciphertext,
    nonce,
    tag,
    ciphertextSha256: hashNonceCiphertextTagHex(nonce, ciphertext, tag)
  };
};

export const decryptPdf = (ciphertext: Buffer, aad: Buffer, dek: Buffer, nonce: Buffer, tag: Buffer) => {
  return decryptAesGcm(ciphertext, aad, dek, nonce, tag);
};
