/**
 * Static country list for nationality dropdown.
 * Source: country-list (ISO 3166-1 alpha-2)
 */

// @ts-expect-error - country-list has no types; getData exists
import { getData } from 'country-list'

export const countries = getData() as ReadonlyArray<{ code: string; name: string }>

export function getCountryByCode(code: string): { code: string; name: string } | undefined {
  return countries.find((c) => c.code === code)
}

/** Convert ISO code to flag emoji (e.g. FI -> 🇫🇮) */
export function codeToFlag(code: string): string {
  return [...code.toUpperCase()]
    .map((c) => String.fromCodePoint(0x1f1e6 - 65 + c.charCodeAt(0)))
    .join('')
}
