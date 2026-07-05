import { describe, expect, it } from "vitest";
import {
  AZURE_KEY_VAULT_WRAP_ALGORITHM,
  AzureKeyVaultKmsProvider,
  type KeyVaultClients,
} from "../src/azureKeyVault.js";
import { encryptPdf, decryptPdf } from "../src/envelope.js";

const KEY_ID_V1 = "https://vault.example.net/keys/pdf-kek/version-1";

/**
 * Fake Key Vault that mimics RSA wrap/unwrap by XOR-ing with a fixed pad —
 * enough to verify the provider passes the right algorithm/key ids and
 * round-trips bytes, without any network calls.
 */
function fakeClients(currentKeyId = KEY_ID_V1) {
  const calls = {
    resolves: 0,
    wraps: [] as { keyId: string; algorithm: string }[],
    unwraps: [] as { keyId: string; algorithm: string }[],
  };
  const pad = 0x5a;
  const clients: KeyVaultClients = {
    async resolveCurrentKeyId() {
      calls.resolves += 1;
      return currentKeyId;
    },
    cryptographyFor(keyId) {
      return {
        async wrapKey(algorithm, key) {
          calls.wraps.push({ keyId, algorithm });
          return { result: Uint8Array.from(key, (b) => b ^ pad), keyID: keyId };
        },
        async unwrapKey(algorithm, encryptedKey) {
          calls.unwraps.push({ keyId, algorithm });
          return { result: Uint8Array.from(encryptedKey, (b) => b ^ pad) };
        },
      };
    },
  };
  return { clients, calls };
}

describe("AzureKeyVaultKmsProvider", () => {
  it("wraps and unwraps a DEK through the Key Vault clients using RSA-OAEP-256", async () => {
    const { clients, calls } = fakeClients();
    const provider = new AzureKeyVaultKmsProvider(clients);

    const dek = Buffer.alloc(32, 3);
    const keyId = await provider.getCurrentKeyId();
    const wrapped = await provider.wrapKey({ keyId, plaintextKey: dek });

    expect(wrapped.keyId).toBe(KEY_ID_V1);
    expect(wrapped.encryptedKey.equals(dek)).toBe(false);

    const unwrapped = await provider.unwrapKey({
      keyId: wrapped.keyId,
      encryptedKey: wrapped.encryptedKey,
    });
    expect(unwrapped.equals(dek)).toBe(true);

    expect(calls.wraps).toEqual([{ keyId: KEY_ID_V1, algorithm: AZURE_KEY_VAULT_WRAP_ALGORITHM }]);
    expect(calls.unwraps).toEqual([
      { keyId: KEY_ID_V1, algorithm: AZURE_KEY_VAULT_WRAP_ALGORITHM },
    ]);
  });

  it("caches the current key id within the TTL and re-resolves after it", async () => {
    const { clients, calls } = fakeClients();
    const provider = new AzureKeyVaultKmsProvider(clients, 50);

    await provider.getCurrentKeyId();
    await provider.getCurrentKeyId();
    expect(calls.resolves).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 60));
    await provider.getCurrentKeyId();
    expect(calls.resolves).toBe(2);
  });

  it("unwraps with the record's stored kekKeyId, not the current key version", async () => {
    const { clients, calls } = fakeClients("https://vault.example.net/keys/pdf-kek/version-2");
    const provider = new AzureKeyVaultKmsProvider(clients);

    await provider.unwrapKey({ keyId: KEY_ID_V1, encryptedKey: Buffer.alloc(32, 9) });
    expect(calls.unwraps[0]?.keyId).toBe(KEY_ID_V1);
  });

  it("throws when Key Vault returns no wrap/unwrap result", async () => {
    const clients: KeyVaultClients = {
      async resolveCurrentKeyId() {
        return KEY_ID_V1;
      },
      cryptographyFor() {
        return {
          async wrapKey() {
            return {};
          },
          async unwrapKey() {
            return {};
          },
        };
      },
    };
    const provider = new AzureKeyVaultKmsProvider(clients);
    await expect(
      provider.wrapKey({ keyId: KEY_ID_V1, plaintextKey: Buffer.alloc(32) }),
    ).rejects.toThrow(/no result/);
    await expect(
      provider.unwrapKey({ keyId: KEY_ID_V1, encryptedKey: Buffer.alloc(32) }),
    ).rejects.toThrow(/no result/);
  });

  it("works end-to-end as the KmsProvider for PDF envelope encryption", async () => {
    const { clients } = fakeClients();
    const provider = new AzureKeyVaultKmsProvider(clients);
    const context = {
      tenantId: "t1",
      propertyId: "p1",
      guestSubmissionId: "s1",
      passengerCardId: "c1",
      requirementVersion: "FI-ACCOMMODATION-2026-01",
      schemaVersion: "encrypted-passenger-card-pdf-v1",
    };

    const plaintext = Buffer.from("%PDF-1.7 fake pdf body");
    const encrypted = await encryptPdf({ plaintext, context, kms: provider });
    expect(encrypted.kekKeyId).toBe(KEY_ID_V1);

    const decrypted = await decryptPdf({
      ciphertext: encrypted.ciphertext,
      encryptedDekBase64: encrypted.encryptedDekBase64,
      ivBase64: encrypted.ivBase64,
      authTagBase64: encrypted.authTagBase64,
      aadJson: encrypted.aadJson,
      kekKeyId: encrypted.kekKeyId,
      kms: provider,
      expectedContext: context,
    });
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it("fromEnv requires vault url and key name", () => {
    expect(() => AzureKeyVaultKmsProvider.fromEnv({} as NodeJS.ProcessEnv)).toThrow(
      /AZURE_KEY_VAULT_URL/,
    );
  });
});
