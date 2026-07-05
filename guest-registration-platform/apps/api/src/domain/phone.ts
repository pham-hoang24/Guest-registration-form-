import { parsePhoneNumber, ParseError } from "libphonenumber-js";

/**
 * Normalizes a Finnish phone number to E.164 format.
 * Accepts: "040 123 4567", "0401234567", "+358 40 123 4567", "00358 40 123 4567".
 * Throws a descriptive error on invalid input.
 */
export function normalizeFinnishPhone(input: string): string {
  try {
    return parsePhoneNumber(input, "FI").number;
  } catch (err) {
    if (err instanceof ParseError) {
      throw new Error(`Invalid phone number: ${err.message}`);
    }
    throw err;
  }
}
