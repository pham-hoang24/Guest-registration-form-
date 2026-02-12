import { createHmac } from "node:crypto";

const wrapSecret = process.env.KEY_VAULT_WRAP_SECRET || "dev-wrap-secret";
const keyId = process.env.KEY_VAULT_KEY_ID || "kv-key";
const keyVersion = process.env.KEY_VAULT_KEY_VERSION || "v1";

export const getKeyInfo = () => ({
  keyId,
  keyVersion
});

export const wrapDekWithKeyVault = async (dek: Buffer) => {
  const mac = createHmac("sha256", wrapSecret).update(dek).digest("hex");
  const wrapped = Buffer.from(`${mac}:${dek.toString("base64")}`, "utf8").toString("base64");
  return { wrappedDek: wrapped, keyId, keyVersion };
};

export const unwrapDekWithKeyVault = async (wrappedDek: string) => {
  const decoded = Buffer.from(wrappedDek, "base64").toString("utf8");
  const [mac, dekB64] = decoded.split(":");
  const dek = Buffer.from(dekB64, "base64");
  const expected = createHmac("sha256", wrapSecret).update(dek).digest("hex");
  if (expected !== mac) {
    throw new Error("Wrapped DEK integrity check failed");
  }
  return dek;
};
