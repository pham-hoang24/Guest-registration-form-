import { DefaultAzureCredential } from "@azure/identity";
import { CryptographyClient, KeyClient } from "@azure/keyvault-keys";
import type { KmsProvider } from "./kms.js";

/**
 * DEKs are wrapped with the Key Vault RSA key using RSA-OAEP-256. A 32-byte
 * DEK fits comfortably in any RSA-2048+ key.
 */
export const AZURE_KEY_VAULT_WRAP_ALGORITHM = "RSA-OAEP-256" as const;

/** How long a resolved "current key version" may be reused before re-resolving. */
const KEY_ID_CACHE_TTL_MS = 5 * 60 * 1000;

export type AzureKeyVaultConfig = {
  /** e.g. https://my-vault.vault.azure.net */
  vaultUrl: string;
  keyName: string;
  /** Pin wrapping to a specific version; unset means "latest version at wrap time". */
  keyVersion?: string;
};

/**
 * Minimal client surface used by the provider. Tests inject fakes; production
 * uses the real @azure/keyvault-keys clients via {@link azureKeyVaultClients}.
 */
export type KeyVaultCryptoClient = {
  wrapKey(
    algorithm: string,
    key: Uint8Array,
  ): Promise<{ result?: Uint8Array; keyID?: string }>;
  unwrapKey(algorithm: string, encryptedKey: Uint8Array): Promise<{ result?: Uint8Array }>;
};

export type KeyVaultClients = {
  /** Resolves the current fully-versioned key id (https://vault/keys/name/version). */
  resolveCurrentKeyId(): Promise<string>;
  cryptographyFor(keyId: string): KeyVaultCryptoClient;
};

export function azureKeyVaultClients(config: AzureKeyVaultConfig): KeyVaultClients {
  const credential = new DefaultAzureCredential();
  const keyClient = new KeyClient(config.vaultUrl, credential);
  return {
    async resolveCurrentKeyId() {
      const key = await keyClient.getKey(
        config.keyName,
        config.keyVersion ? { version: config.keyVersion } : undefined,
      );
      if (!key.id) {
        throw new Error("Key Vault returned a key without an id");
      }
      return key.id;
    },
    cryptographyFor(keyId) {
      return new CryptographyClient(keyId, credential);
    },
  };
}

/**
 * KmsProvider backed by Azure Key Vault. The KEK never leaves the vault:
 * wrap/unwrap are remote operations. Records store the fully-versioned
 * kekKeyId, so unwrapping keeps working after key rotation and new wraps
 * automatically pick up the latest version.
 */
export class AzureKeyVaultKmsProvider implements KmsProvider {
  private cachedKeyId: string | null = null;
  private cachedAtMs = 0;

  constructor(
    private readonly clients: KeyVaultClients,
    private readonly keyIdCacheTtlMs: number = KEY_ID_CACHE_TTL_MS,
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): AzureKeyVaultKmsProvider {
    const vaultUrl = env.AZURE_KEY_VAULT_URL;
    const keyName = env.AZURE_KEY_VAULT_KEY_NAME;
    if (!vaultUrl || !keyName) {
      throw new Error(
        "AZURE_KEY_VAULT_URL and AZURE_KEY_VAULT_KEY_NAME must be set for KMS_PROVIDER=azure-key-vault",
      );
    }
    return new AzureKeyVaultKmsProvider(
      azureKeyVaultClients({
        vaultUrl,
        keyName,
        keyVersion: env.AZURE_KEY_VAULT_KEY_VERSION || undefined,
      }),
    );
  }

  async getCurrentKeyId(): Promise<string> {
    const now = Date.now();
    if (this.cachedKeyId && now - this.cachedAtMs < this.keyIdCacheTtlMs) {
      return this.cachedKeyId;
    }
    this.cachedKeyId = await this.clients.resolveCurrentKeyId();
    this.cachedAtMs = now;
    return this.cachedKeyId;
  }

  async wrapKey(args: { keyId: string; plaintextKey: Buffer }): Promise<{
    encryptedKey: Buffer;
    keyId: string;
  }> {
    const response = await this.clients
      .cryptographyFor(args.keyId)
      .wrapKey(AZURE_KEY_VAULT_WRAP_ALGORITHM, args.plaintextKey);
    if (!response.result) {
      throw new Error("Key Vault wrapKey returned no result");
    }
    return {
      encryptedKey: Buffer.from(response.result),
      keyId: response.keyID ?? args.keyId,
    };
  }

  async unwrapKey(args: { keyId: string; encryptedKey: Buffer }): Promise<Buffer> {
    const response = await this.clients
      .cryptographyFor(args.keyId)
      .unwrapKey(AZURE_KEY_VAULT_WRAP_ALGORITHM, args.encryptedKey);
    if (!response.result) {
      throw new Error("Key Vault unwrapKey returned no result");
    }
    return Buffer.from(response.result);
  }
}
