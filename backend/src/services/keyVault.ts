import type { KekAdapter } from "../crypto/keyVaultKek.js";
import { KeyVaultKekAdapter } from "../crypto/keyVaultKek.js";

let adapter: KekAdapter | null = null;

const getAdapter = () => {
  if (!adapter) {
    adapter = KeyVaultKekAdapter.fromEnv();
  }
  return adapter;
};

/** Override the KEK adapter for tests. Call with null to restore default. */
export function setKekAdapterForTests(a: KekAdapter | null): void {
  adapter = a;
}

export const wrapDekWithKeyVault = async (dek: Buffer) => {
  const wrapped = await getAdapter().wrapDek(dek);
  return {
    wrappedDek: wrapped.wrappedDek.toString("base64"),
    keyId: wrapped.kekKeyId,
    keyVersion: wrapped.kekKeyVersion
  };
};

export const unwrapDekWithKeyVault = async (wrappedDek: string, kekKeyId?: string, kekKeyVersion?: string) => {
  const wrapped = Buffer.from(wrappedDek, "base64");
  return getAdapter().unwrapDek(wrapped, kekKeyId ?? "", kekKeyVersion);
};
