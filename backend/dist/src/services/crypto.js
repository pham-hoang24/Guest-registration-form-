import { buildAadBytes } from "../crypto/aad.js";
import { decryptAesGcm, encryptAesGcm, generateDek } from "../crypto/aesgcm.js";
import { hashNonceCiphertextTagHex } from "../crypto/hashes.js";
export { generateDek, buildAadBytes };
export const encryptPdf = (plaintext, aad, dek) => {
    const { nonce, ciphertext, tag } = encryptAesGcm(plaintext, aad, dek);
    return {
        ciphertext,
        nonce,
        tag,
        ciphertextSha256: hashNonceCiphertextTagHex(nonce, ciphertext, tag)
    };
};
export const decryptPdf = (ciphertext, aad, dek, nonce, tag) => {
    return decryptAesGcm(ciphertext, aad, dek, nonce, tag);
};
