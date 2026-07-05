import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { KmsProvider } from "./kms.js";

/**
 * Envelope encryption for small string fields (e.g. guest document numbers).
 * Same construction as PDF encryption — fresh DEK + IV per value, AES-256-GCM
 * with AAD — serialized to a single JSON string for a database column.
 *
 * FieldContext binds the ciphertext to the exact row it was created for.
 * All six keys are included in the AAD in a fixed alphabetical order so the
 * serialization is deterministic regardless of property insertion order.
 */
export type FieldContext = {
  tenantId: string;
  propertyId: string;
  guestSubmissionId: string;
  passengerCardId: string;
  guestId: string;
  field: string;
};

type SealedField = {
  v: 2;
  encryptedDek: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  aad: string;
  kekKeyId: string;
};

function buildFieldAad(context: FieldContext): string {
  // Fixed key order — must not change without a migration.
  return JSON.stringify({
    field: context.field,
    guestId: context.guestId,
    guestSubmissionId: context.guestSubmissionId,
    passengerCardId: context.passengerCardId,
    propertyId: context.propertyId,
    tenantId: context.tenantId,
  });
}

export async function encryptString(args: {
  plaintext: string;
  context: FieldContext;
  kms: KmsProvider;
}): Promise<string> {
  const dek = randomBytes(32);
  const iv = randomBytes(12);
  const aad = buildFieldAad(args.context);

  const cipher = createCipheriv("aes-256-gcm", dek, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(args.plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const keyId = await args.kms.getCurrentKeyId();
  const wrapped = await args.kms.wrapKey({ keyId, plaintextKey: dek });
  dek.fill(0);

  const sealed: SealedField = {
    v: 2,
    encryptedDek: wrapped.encryptedKey.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    aad,
    kekKeyId: wrapped.keyId,
  };
  return JSON.stringify(sealed);
}

export async function decryptString(args: {
  sealed: string;
  context: FieldContext;
  kms: KmsProvider;
}): Promise<string> {
  const parsed = JSON.parse(args.sealed) as SealedField;
  if (parsed.v !== 2) {
    throw new Error(`Unsupported sealed field version: ${parsed.v}`);
  }
  const expectedAad = buildFieldAad(args.context);
  if (parsed.aad !== expectedAad) {
    throw new Error("AAD mismatch: sealed field is not bound to this context");
  }

  const dek = await args.kms.unwrapKey({
    keyId: parsed.kekKeyId,
    encryptedKey: Buffer.from(parsed.encryptedDek, "base64"),
  });

  try {
    const decipher = createDecipheriv("aes-256-gcm", dek, Buffer.from(parsed.iv, "base64"));
    decipher.setAAD(Buffer.from(parsed.aad, "utf8"));
    decipher.setAuthTag(Buffer.from(parsed.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } finally {
    dek.fill(0);
  }
}
