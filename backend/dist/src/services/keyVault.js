import { KeyVaultKekAdapter } from "../crypto/keyVaultKek.js";
let adapter = null;
const getAdapter = () => {
    if (!adapter) {
        adapter = KeyVaultKekAdapter.fromEnv();
    }
    return adapter;
};
export const wrapDekWithKeyVault = async (dek) => {
    const wrapped = await getAdapter().wrapDek(dek);
    return {
        wrappedDek: wrapped.wrappedDek.toString("base64"),
        keyId: wrapped.kekKeyId,
        keyVersion: wrapped.kekKeyVersion
    };
};
export const unwrapDekWithKeyVault = async (wrappedDek, kekKeyId, kekKeyVersion) => {
    const wrapped = Buffer.from(wrappedDek, "base64");
    return getAdapter().unwrapDek(wrapped, kekKeyId ?? "", kekKeyVersion);
};
