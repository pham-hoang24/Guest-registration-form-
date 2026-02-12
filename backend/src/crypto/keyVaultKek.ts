import { DefaultAzureCredential } from "@azure/identity";
import { CryptographyClient, KeyClient } from "@azure/keyvault-keys";

import { CryptoError, DEK_LENGTH } from "./aesgcm.js";

export const WRAP_ALGORITHM = "RSA-OAEP-256" as const;

export type WrapResult = {
  wrappedDek: Buffer;
  kekKeyId: string;
  kekKeyVersion: string;
  algorithm: typeof WRAP_ALGORITHM;
};

export interface KekAdapter {
  wrapDek(dek: Buffer): Promise<WrapResult>;
  unwrapDek(wrappedDek: Buffer, kekKeyId: string, kekKeyVersion?: string): Promise<Buffer>;
}

type KeyVaultKekOptions = {
  keyVaultUrl: string;
  keyName: string;
  keyVersion?: string;
};

export class KeyVaultKekAdapter implements KekAdapter {
  private credential = new DefaultAzureCredential();
  private keyClient: KeyClient;
  private keyVersion?: string;
  private keyName: string;
  private keyVaultUrl: string;

  constructor(options: KeyVaultKekOptions) {
    this.keyVaultUrl = options.keyVaultUrl;
    this.keyName = options.keyName;
    this.keyVersion = options.keyVersion;
    this.keyClient = new KeyClient(this.keyVaultUrl, this.credential);
  }

  static fromEnv() {
    const keyVaultUrl = process.env.KEYVAULT_URL;
    const keyName = process.env.KEK_KEY_NAME;
    const keyVersion = process.env.KEK_KEY_VERSION;
    if (!keyVaultUrl || !keyName) {
      throw new CryptoError("KEYVAULT_URL and KEK_KEY_NAME must be set");
    }
    return new KeyVaultKekAdapter({ keyVaultUrl, keyName, keyVersion });
  }

  async wrapDek(dek: Buffer): Promise<WrapResult> {
    if (dek.length !== DEK_LENGTH) {
      throw new CryptoError("Invalid DEK length");
    }
    const key = await this.keyClient.getKey(this.keyName, this.keyVersion);
    if (!key.id || !key.properties?.version) {
      throw new CryptoError("Key Vault key metadata missing");
    }
    const cryptoClient = new CryptographyClient(key.id, this.credential);
    const response = await cryptoClient.wrapKey(WRAP_ALGORITHM, dek);
    if (!response.result || !response.keyId) {
      throw new CryptoError("Failed to wrap DEK with Key Vault");
    }
    const kekKeyId = response.keyId;
    const kekKeyVersion = parseKeyVersionFromId(kekKeyId) ?? key.properties.version;
    return {
      wrappedDek: Buffer.from(response.result),
      kekKeyId,
      kekKeyVersion,
      algorithm: WRAP_ALGORITHM
    };
  }

  async unwrapDek(wrappedDek: Buffer, kekKeyId: string, kekKeyVersion?: string): Promise<Buffer> {
    if (!kekKeyId) {
      throw new CryptoError("Missing Key Vault key id");
    }
    const effectiveKeyId = ensureKeyIdHasVersion(kekKeyId, kekKeyVersion);
    const cryptoClient = new CryptographyClient(effectiveKeyId, this.credential);
    const response = await cryptoClient.unwrapKey(WRAP_ALGORITHM, wrappedDek);
    if (!response.result) {
      throw new CryptoError("Failed to unwrap DEK with Key Vault");
    }
    return Buffer.from(response.result);
  }
}

export const parseKeyVersionFromId = (keyId: string) => {
  const parts = keyId.split("/");
  const version = parts[parts.length - 1];
  return version || null;
};

const ensureKeyIdHasVersion = (keyId: string, keyVersion?: string) => {
  if (!keyVersion) return keyId;
  if (keyId.endsWith(`/${keyVersion}`)) return keyId;
  return `${keyId}/${keyVersion}`;
};

export class MockKekAdapter implements KekAdapter {
  public lastWrapKeyId: string | null = null;
  public lastWrapAlgorithm: string | null = null;
  public lastUnwrapKeyId: string | null = null;

  constructor(private keyId: string, private keyVersion: string) {}

  async wrapDek(dek: Buffer): Promise<WrapResult> {
    this.lastWrapAlgorithm = WRAP_ALGORITHM;
    this.lastWrapKeyId = `${this.keyId}/${this.keyVersion}`;
    const wrapped = Buffer.from(dek.toString("base64"), "utf8");
    return {
      wrappedDek: wrapped,
      kekKeyId: this.lastWrapKeyId,
      kekKeyVersion: this.keyVersion,
      algorithm: WRAP_ALGORITHM
    };
  }

  async unwrapDek(wrappedDek: Buffer, kekKeyId: string): Promise<Buffer> {
    this.lastUnwrapKeyId = kekKeyId;
    const decoded = Buffer.from(wrappedDek.toString("utf8"), "base64");
    return decoded;
  }
}
