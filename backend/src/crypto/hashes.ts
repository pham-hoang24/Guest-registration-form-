import { createHash, timingSafeEqual } from "node:crypto";

export const sha256Buffer = (data: Buffer | string) => {
  const buffer = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return createHash("sha256").update(buffer).digest();
};

export const sha256Hex = (data: Buffer | string) => {
  return sha256Buffer(data).toString("hex");
};

export const timingSafeEqualHex = (leftHex: string, rightHex: string) => {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

export const timingSafeEqualBuffer = (left: Buffer, right: Buffer) => {
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

export const hashNonceCiphertextTagHex = (nonce: Buffer, ciphertext: Buffer, tag: Buffer) => {
  return sha256Hex(Buffer.concat([nonce, ciphertext, tag]));
};

export const assertHashMatch = (expectedHex: string, actualHex: string, label: string) => {
  if (!timingSafeEqualHex(expectedHex, actualHex)) {
    throw new Error(`${label} mismatch`);
  }
};
