import { describe, expect, it } from "vitest";
import {
  COUNTRY_CODES,
  normalizeCountryCode,
  isKnownCountryCode,
  countryNameFromCode,
} from "../src/country.js";

describe("country", () => {
  it("has a plausible, de-duplicated ISO 3166-1 alpha-2 list", () => {
    expect(COUNTRY_CODES.length).toBeGreaterThan(240);
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    for (const code of ["FI", "SE", "US", "VN"]) {
      expect(COUNTRY_CODES).toContain(code);
    }
  });

  it("normalizes case and whitespace, round-trips a known code", () => {
    expect(normalizeCountryCode("  fi ")).toBe("FI");
    expect(normalizeCountryCode("de")).toBe("DE");
    expect(isKnownCountryCode("Se")).toBe(true);
  });

  it("rejects unknown or malformed codes", () => {
    for (const bad of ["XX", "ZZ", "FIN", "F", "", "12"]) {
      expect(normalizeCountryCode(bad)).toBeNull();
      expect(isKnownCountryCode(bad)).toBe(false);
    }
  });

  it("resolves an English display name and falls back gracefully", () => {
    expect(countryNameFromCode("FI")).toBe("Finland");
    // Unknown code falls back to the normalized input rather than throwing.
    expect(countryNameFromCode("xx")).toBe("XX");
  });
});
