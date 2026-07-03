import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Key-management abstraction. The MVP ships LocalKmsProvider; production is
 * expected to implement this with Azure Key Vault (RSA-OAEP-256 wrapKey /
 * unwrapKey) without touching callers.
 */
export interface KmsProvider {
  getCurrentKeyId(): Promise<string>;

  wrapKey(args: { keyId: string; plaintextKey: Buffer }): Promise<{
    encryptedKey: Buffer;
    keyId: string;
  }>;

  unwrapKey(args: { keyId: string; encryptedKey: Buffer }): Promise<Buffer>;
}

const LOCAL_KEY_ID_PREFIX = "local-kms";

/**
 * Dev-only KMS: wraps DEKs with AES-256-GCM under a master key supplied via
 * environment. The wrapped blob layout is iv(12) || authTag(16) || ciphertext.
 * The keyId embeds a fingerprint of the master key so a wrong master key is
 * detected as a keyId mismatch instead of a generic decrypt failure.
 */
export class LocalKmsProvider implements KmsProvider {
  private readonly masterKey: Buffer;
  private readonly keyId: string;

  constructor(masterKeyBase64: string) {
    const key = Buffer.from(masterKeyBase64, "base64");
    if (key.length !== 32) {
      throw new Error("LOCAL_KMS_MASTER_KEY_BASE64 must decode to exactly 32 bytes");
    }
    this.masterKey = key;
    const fingerprint = createHash("sha256").update(key).digest("hex").slice(0, 16);
    this.keyId = `${LOCAL_KEY_ID_PREFIX}:${fingerprint}`;
  }

  async getCurrentKeyId(): Promise<string> {
    return this.keyId;
  }

  async wrapKey(args: { keyId: string; plaintextKey: Buffer }): Promise<{
    encryptedKey: Buffer;
    keyId: string;
  }> {
    if (args.keyId !== this.keyId) {
      throw new Error("Unknown KMS keyId");
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.masterKey, iv);
    const ciphertext = Buffer.concat([cipher.update(args.plaintextKey), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return { encryptedKey: Buffer.concat([iv, authTag, ciphertext]), keyId: this.keyId };
  }

  async unwrapKey(args: { keyId: string; encryptedKey: Buffer }): Promise<Buffer> {
    if (args.keyId !== this.keyId) {
      throw new Error("Unknown KMS keyId");
    }
    if (args.encryptedKey.length < 12 + 16 + 1) {
      throw new Error("Malformed wrapped key");
    }
    const iv = args.encryptedKey.subarray(0, 12);
    const authTag = args.encryptedKey.subarray(12, 28);
    const ciphertext = args.encryptedKey.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.masterKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}

export function kmsProviderFromEnv(env: NodeJS.ProcessEnv = process.env): KmsProvider {
  const provider = env.KMS_PROVIDER ?? "local";
  if (provider === "local") {
    const masterKey = env.LOCAL_KMS_MASTER_KEY_BASE64;
    if (!masterKey || masterKey === "replace_with_32_bytes_base64") {
      throw new Error(
        "LOCAL_KMS_MASTER_KEY_BASE64 is not set. Generate one with: " +
          `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
      );
    }
    return new LocalKmsProvider(masterKey);
  }
  // Extension point: return an AzureKeyVaultKmsProvider here.
  throw new Error(`Unsupported KMS_PROVIDER: ${provider}`);
}
