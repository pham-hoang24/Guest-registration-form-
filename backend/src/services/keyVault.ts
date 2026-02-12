import { KeyVaultKekAdapter } from "../crypto/keyVaultKek.js";

let adapter: KeyVaultKekAdapter | null = null;

const getAdapter = () => {
  if (!adapter) {
    adapter = KeyVaultKekAdapter.fromEnv();
  }
  return adapter;
};

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
