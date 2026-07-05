import { parsePhoneNumber, ParseError, type CountryCode } from "libphonenumber-js";

/**
 * Normalizes a phone number to E.164 format.
 * With the default country FI accepts: "040 123 4567", "0401234567",
 * "+358 40 123 4567", "00358 40 123 4567".
 * Throws a descriptive error on invalid input.
 */
export function normalizePhoneToE164(input: string, defaultCountry: CountryCode = "FI"): string {
  try {
    const parsed = parsePhoneNumber(input, defaultCountry);
    if (!parsed.isValid()) {
      throw new Error("Invalid phone number");
    }
    return parsed.number;
  } catch (err) {
    if (err instanceof ParseError) {
      throw new Error(`Invalid phone number: ${err.message}`, { cause: err });
    }
    throw err;
  }
}

/** True when `input` parses to a valid phone number for `defaultCountry`. */
export function isValidPhone(input: string, defaultCountry: CountryCode = "FI"): boolean {
  try {
    return parsePhoneNumber(input, defaultCountry).isValid();
  } catch {
    return false;
  }
}

/** @deprecated use {@link normalizePhoneToE164}. */
export const normalizeFinnishPhone = (input: string): string => normalizePhoneToE164(input, "FI");
