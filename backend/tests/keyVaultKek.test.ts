import { describe, expect, it } from "vitest";
import { MockKekAdapter, WRAP_ALGORITHM } from "../src/crypto/keyVaultKek.js";
import { generateDek } from "../src/crypto/aesgcm.js";

describe("key vault KEK adapter mock", () => {
  it("records algorithm and key id on wrap", async () => {
    const adapter = new MockKekAdapter("https://kv/keys/kek", "v1");
    const dek = generateDek();
    const wrapped = await adapter.wrapDek(dek);
    expect(wrapped.algorithm).toBe(WRAP_ALGORITHM);
    expect(wrapped.kekKeyId).toContain("https://kv/keys/kek");
    expect(wrapped.kekKeyVersion).toBe("v1");
    expect(adapter.lastWrapAlgorithm).toBe(WRAP_ALGORITHM);
    expect(adapter.lastWrapKeyId).toBe("https://kv/keys/kek/v1");
    const unwrapped = await adapter.unwrapDek(wrapped.wrappedDek, wrapped.kekKeyId);
    expect(unwrapped.toString("hex")).toBe(dek.toString("hex"));
  });
});
