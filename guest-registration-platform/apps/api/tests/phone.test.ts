import { describe, expect, it } from "vitest";
import { normalizePhoneToE164, isValidPhone } from "../src/domain/phone.js";

describe("normalizePhoneToE164 (FI default)", () => {
  it.each([
    ["040 123 4567", "+358401234567"],
    ["0401234567", "+358401234567"],
    ["+358 40 123 4567", "+358401234567"],
    ["00358 40 123 4567", "+358401234567"],
  ])("normalizes %s → %s", (input, expected) => {
    expect(normalizePhoneToE164(input)).toBe(expected);
  });

  it("rejects invalid input", () => {
    expect(() => normalizePhoneToE164("123")).toThrow();
    expect(isValidPhone("123")).toBe(false);
  });

  it("isValidPhone accepts a valid Finnish number", () => {
    expect(isValidPhone("040 123 4567")).toBe(true);
  });
});
