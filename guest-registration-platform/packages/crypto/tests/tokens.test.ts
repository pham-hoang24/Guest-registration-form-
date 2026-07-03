import { describe, expect, it } from "vitest";
import { generateRegistrationToken, hashRegistrationToken } from "../src/index.js";

describe("registration tokens", () => {
  it("generates high-entropy url-safe tokens", () => {
    const token = generateRegistrationToken();
    expect(token.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(generateRegistrationToken()).not.toBe(token);
  });

  it("hashes deterministically with sha256 hex", () => {
    const token = generateRegistrationToken();
    const hash = hashRegistrationToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRegistrationToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
  });
});
