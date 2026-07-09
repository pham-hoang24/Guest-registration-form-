/**
 * Finnish personal identity code (henkilötunnus / HETU) validation + birthdate
 * derivation.
 *
 * Format: DDMMYY C ZZZ Q  (11 chars, no separators)
 *   DDMMYY — birth date (day, month, two-digit year)
 *   C      — century sign that disambiguates the year:
 *              '+'                          → 1800s
 *              '-','Y','X','W','V','U'      → 1900s
 *              'A','B','C','D','E','F'      → 2000s
 *   ZZZ    — individual number (001–899)
 *   Q      — control character = number(DDMMYYZZZ) mod 31 mapped via CONTROL_CHARS
 *
 * SECURITY: a PIC is sensitive personal data. It is validated here and encrypted
 * at rest (invariant 2); it must NEVER be logged. These helpers deliberately do
 * no logging and take/return only the value.
 */

const CENTURY_BY_SIGN: Record<string, number> = {
  "+": 1800,
  "-": 1900,
  Y: 1900,
  X: 1900,
  W: 1900,
  V: 1900,
  U: 1900,
  A: 2000,
  B: 2000,
  C: 2000,
  D: 2000,
  E: 2000,
  F: 2000,
};

// Control-character alphabet: note the absence of G, I, O, Q, Z (and vowels).
const CONTROL_CHARS = "0123456789ABCDEFHJKLMNPRSTUVWXY";

const HETU_RE =
  /^(\d{2})(\d{2})(\d{2})([-+ABCDEFUVWXY])(\d{3})([0-9ABCDEFHJKLMNPRSTUVWXY])$/;

/** Uppercase + trim; the century sign and control letter are case-insensitive. */
export function normalizeFinnishPic(input: string): string {
  return input.trim().toUpperCase();
}

type ParsedPic = { birthDate: string };

/**
 * Parses and fully validates a PIC (format, checksum, real calendar date).
 * Returns the derived birth date as an ISO `YYYY-MM-DD` string, or `null` when
 * the value is not a valid PIC.
 */
export function parseFinnishPic(input: string): ParsedPic | null {
  const value = normalizeFinnishPic(input);
  const m = HETU_RE.exec(value);
  if (!m) return null;

  const [, dd, mm, yy, sign, individual, control] = m;
  const century = CENTURY_BY_SIGN[sign!];
  if (century === undefined) return null;

  const day = Number(dd);
  const month = Number(mm);
  const year = century + Number(yy);

  // Individual number 001–899 (900+ are reserved / test ranges we reject).
  const individualNumber = Number(individual);
  if (individualNumber < 1 || individualNumber > 899) return null;

  // Checksum: the 9-digit number DDMMYYZZZ mod 31 indexes CONTROL_CHARS.
  const checkNumber = Number(`${dd}${mm}${yy}${individual}`);
  const expected = CONTROL_CHARS[checkNumber % 31];
  if (expected !== control) return null;

  // Reject impossible calendar dates (e.g. 3102 = 31 Feb).
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  const monthStr = String(month).padStart(2, "0");
  const dayStr = String(day).padStart(2, "0");
  return { birthDate: `${year}-${monthStr}-${dayStr}` };
}

/** True when `input` is a fully valid Finnish personal identity code. */
export function isValidFinnishPic(input: string): boolean {
  return parseFinnishPic(input) !== null;
}

/** Derived birth date (`YYYY-MM-DD`) for a valid PIC, else `null`. */
export function finnishPicBirthDate(input: string): string | null {
  return parseFinnishPic(input)?.birthDate ?? null;
}
