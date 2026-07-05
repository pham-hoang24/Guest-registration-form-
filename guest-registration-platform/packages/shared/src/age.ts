/**
 * Full years old on `referenceDate`, computed with real calendar math so the
 * exact-18-on-arrival boundary is correct (a 365.25-day approximation is off by
 * up to a day near birthdays / leap years).
 *
 * Both inputs are treated as calendar dates (UTC midnight); time-of-day is ignored.
 */
export function ageOn(dateOfBirth: string | Date, referenceDate: string | Date): number {
  const dob = toUtcDate(dateOfBirth);
  const ref = toUtcDate(referenceDate);

  let age = ref.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = ref.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && ref.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
}

function toUtcDate(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  return new Date(`${value.slice(0, 10)}T00:00:00Z`);
}
