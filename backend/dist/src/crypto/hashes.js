import { createHash, timingSafeEqual } from "node:crypto";
export const sha256Buffer = (data) => {
    const buffer = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    return createHash("sha256").update(buffer).digest();
};
export const sha256Hex = (data) => {
    return sha256Buffer(data).toString("hex");
};
export const timingSafeEqualHex = (leftHex, rightHex) => {
    const left = Buffer.from(leftHex, "hex");
    const right = Buffer.from(rightHex, "hex");
    if (left.length !== right.length)
        return false;
    return timingSafeEqual(left, right);
};
export const timingSafeEqualBuffer = (left, right) => {
    if (left.length !== right.length)
        return false;
    return timingSafeEqual(left, right);
};
export const hashNonceCiphertextTagHex = (nonce, ciphertext, tag) => {
    return sha256Hex(Buffer.concat([nonce, ciphertext, tag]));
};
export const assertHashMatch = (expectedHex, actualHex, label) => {
    if (!timingSafeEqualHex(expectedHex, actualHex)) {
        throw new Error(`${label} mismatch`);
    }
};
