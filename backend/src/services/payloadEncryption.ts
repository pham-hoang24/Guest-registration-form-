import { buildPayloadAadBytes } from "../crypto/aad.js";
import { CRYPTO_VERSION, decryptAesGcm, encryptAesGcm, generateDek } from "../crypto/aesgcm.js";
import { assertHashMatch, hashNonceCiphertextTagHex } from "../crypto/hashes.js";
import type { KekAdapter } from "../crypto/keyVaultKek.js";
import { AAD_VERSION } from "../crypto/aad.js";

export const PAYLOAD_SCHEMA_VERSION = 1;

export type EncryptedPayloadRecord = {
  nonce: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
  wrappedDek: Buffer;
  kekKeyId: string;
  kekKeyVersion: string;
  aadVersion: number;
  schemaVersion: number;
  ciphertextSha256Hex: string;
};

export type EncryptPayloadContext = {
  tenantId: string;
  propertyId: string;
  submissionId: string;
};

/**
 * Encrypt plaintext (e.g. JSON string) with per-submission DEK, AAD, and KEK wrap.
 * Matches PDF encryption design: no single static key.
 */
export const encryptPayload = async (
  plaintext: string,
  context: EncryptPayloadContext,
  kekAdapter: KekAdapter
): Promise<EncryptedPayloadRecord> => {
  const dek = generateDek();
  const aadBytes = buildPayloadAadBytes({
    aadVersion: AAD_VERSION,
    tenantId: context.tenantId,
    propertyId: context.propertyId,
    submissionId: context.submissionId,
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    cryptoVersion: CRYPTO_VERSION
  });
  const plaintextBuf = Buffer.from(plaintext, "utf8");
  const { nonce, ciphertext, tag } = encryptAesGcm(plaintextBuf, aadBytes, dek);
  const ciphertextSha256Hex = hashNonceCiphertextTagHex(nonce, ciphertext, tag);
  const wrapped = await kekAdapter.wrapDek(dek);

  return {
    nonce,
    tag,
    ciphertext,
    wrappedDek: wrapped.wrappedDek,
    kekKeyId: wrapped.kekKeyId,
    kekKeyVersion: wrapped.kekKeyVersion,
    aadVersion: 1,
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    ciphertextSha256Hex
  };
};

/**
 * Decrypt an encrypted payload record: unwrap DEK, verify hash, decrypt with AAD.
 */
export const decryptPayload = async (
  record: EncryptedPayloadRecord,
  context: EncryptPayloadContext,
  kekAdapter: KekAdapter
): Promise<string> => {
  const aadBytes = buildPayloadAadBytes({
    aadVersion: String(record.aadVersion),
    tenantId: context.tenantId,
    propertyId: context.propertyId,
    submissionId: context.submissionId,
    schemaVersion: record.schemaVersion,
    cryptoVersion: CRYPTO_VERSION
  });
  const actualHash = hashNonceCiphertextTagHex(record.nonce, record.ciphertext, record.tag);
  assertHashMatch(record.ciphertextSha256Hex, actualHash, "Payload ciphertext");

  const dek = await kekAdapter.unwrapDek(
    record.wrappedDek,
    record.kekKeyId,
    record.kekKeyVersion
  );
  const plaintext = decryptAesGcm(
    record.ciphertext,
    aadBytes,
    dek,
    record.nonce,
    record.tag
  );
  return plaintext.toString("utf8");
};
