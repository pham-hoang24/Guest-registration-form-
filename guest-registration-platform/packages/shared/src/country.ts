/**
 * ISO 3166-1 alpha-2 country codes and helpers.
 *
 * Storage / API / fingerprint always use the canonical two-letter uppercase code.
 * The guest UI renders a localized name (+ flag) and the PDF renders the full
 * English name; both derive from the code via `Intl.DisplayNames`, so no country
 * name is ever hand-typed or stored. Unknown codes are rejected at the trust
 * boundary.
 */

// The 249 officially assigned ISO 3166-1 alpha-2 codes.
export const COUNTRY_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS",
  "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN",
  "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE",
  "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF",
  "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM",
  "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM",
  "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC",
  "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK",
  "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG",
  "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS",
  "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO",
  "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW",
] as const;

export type CountryCode = (typeof COUNTRY_CODES)[number];

const COUNTRY_CODE_SET: ReadonlySet<string> = new Set<string>(COUNTRY_CODES);

/** Trim + uppercase; returns the canonical code only when it is assigned, else `null`. */
export function normalizeCountryCode(input: string): CountryCode | null {
  const code = input.trim().toUpperCase();
  return COUNTRY_CODE_SET.has(code) ? (code as CountryCode) : null;
}

export function isKnownCountryCode(input: string): boolean {
  return normalizeCountryCode(input) !== null;
}

/**
 * Localized country name for a code (default English). Falls back to the code
 * itself if the runtime cannot resolve it. Used for guest UI (localized) and the
 * PDF (English) — never for storage.
 */
export function countryNameFromCode(input: string, locale = "en"): string {
  const code = normalizeCountryCode(input);
  if (!code) return input.trim().toUpperCase();
  try {
    const display = new Intl.DisplayNames([locale], { type: "region" });
    return display.of(code) ?? code;
  } catch {
    return code;
  }
}
