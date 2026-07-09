import { COUNTRY_CODES, countryNameFromCode } from "@gr/shared";

export type CountryOption = { code: string; name: string };

/**
 * ISO 3166-1 alpha-2 options with localized names, sorted for the given locale.
 * Memoized per locale so the list (~249 entries) is built once.
 */
const cache = new Map<string, CountryOption[]>();

export function countryOptions(locale: string): CountryOption[] {
  const key = locale.slice(0, 2);
  const cached = cache.get(key);
  if (cached) return cached;
  const options = COUNTRY_CODES.map((code) => ({ code, name: countryNameFromCode(code, key) })).sort(
    (a, b) => a.name.localeCompare(b.name, key),
  );
  cache.set(key, options);
  return options;
}
