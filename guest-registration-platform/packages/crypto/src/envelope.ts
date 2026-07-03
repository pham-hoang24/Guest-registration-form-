import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { KmsProvider } from "./kms.js";

export type EncryptionContext = {
  tenantId: string;
  propertyId: string;
  submissionId: string;
  requirementVersion: string;
};

export type EncryptResult = {
  ciphertext: Buffer;
  encryptedDekBase64: string;
  ivBase64: string;
  authTagBase64: string;
  aadJson: string;
  kekKeyId: string;
  algorithm: "AES-256-GCM";
  sha256Ciphertext: string;
};

/**
 * Canonical AAD: JSON with keys sorted so the exact byte sequence is
 * reproducible at decrypt time. AES-GCM authenticates these bytes, binding
 * the ciphertext to its tenant/property/submission/requirement version —
 * a ciphertext moved to another submission's row will fail to decrypt.
 */
export function buildAadJson(context: EncryptionContext): string {
  const sortedKeys = Object.keys(context).sort() as (keyof EncryptionContext)[];
  const canonical: Record<string, string> = {};
  for (const key of sortedKeys) {
    canonical[key] = context[key];
  }
  return JSON.stringify(canonical);
}

export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function encryptPdf(args: {
  plaintext: Uint8Array;
  context: EncryptionContext;
  kms: KmsProvider;
}): Promise<EncryptResult> {
  const dek = randomBytes(32);
  const iv = randomBytes(12);
  const aadJson = buildAadJson(args.context);

  const cipher = createCipheriv("aes-256-gcm", dek, iv);
  cipher.setAAD(Buffer.from(aadJson, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(args.plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const keyId = await args.kms.getCurrentKeyId();
  const wrapped = await args.kms.wrapKey({ keyId, plaintextKey: dek });
  dek.fill(0);

  return {
    ciphertext,
    encryptedDekBase64: wrapped.encryptedKey.toString("base64"),
    ivBase64: iv.toString("base64"),
    authTagBase64: authTag.toString("base64"),
    aadJson,
    kekKeyId: wrapped.keyId,
    algorithm: "AES-256-GCM",
    sha256Ciphertext: sha256Hex(ciphertext),
  };
}

export async function decryptPdf(args: {
  ciphertext: Buffer;
  encryptedDekBase64: string;
  ivBase64: string;
  authTagBase64: string;
  aadJson: string;
  kekKeyId: string;
  kms: KmsProvider;
  /** When provided, the stored AAD must equal the AAD rebuilt from this context. */
  expectedContext?: EncryptionContext;
}): Promise<Buffer> {
  if (args.expectedContext) {
    const expectedAad = buildAadJson(args.expectedContext);
    if (expectedAad !== args.aadJson) {
      throw new Error("AAD mismatch: ciphertext is not bound to this submission");
    }
  }

  const dek = await args.kms.unwrapKey({
    keyId: args.kekKeyId,
    encryptedKey: Buffer.from(args.encryptedDekBase64, "base64"),
  });

  try {
    const decipher = createDecipheriv("aes-256-gcm", dek, Buffer.from(args.ivBase64, "base64"));
    decipher.setAAD(Buffer.from(args.aadJson, "utf8"));
    decipher.setAuthTag(Buffer.from(args.authTagBase64, "base64"));
    return Buffer.concat([decipher.update(args.ciphertext), decipher.final()]);
  } finally {
    dek.fill(0);
  }
}
