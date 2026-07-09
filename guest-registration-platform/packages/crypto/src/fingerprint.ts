import { createHmac } from "node:crypto";

/**
 * Normalized guest data included in the fingerprint.
 * Excludes: signature bytes, raw email/phone, timestamps, IP/UA.
 * All string fields are trimmed+lowercased; dates are ISO strings.
 */
export type GuestFingerprintData = {
  guestType: string;
  roleOnCard: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  citizenship?: string;
  documentNumber?: string;
};

export type CardFingerprintData = {
  cardType: string;
  guests: GuestFingerprintData[];
};

function normalizeGuest(g: GuestFingerprintData): Record<string, string | undefined> {
  return {
    guestType: g.guestType.trim().toLowerCase(),
    roleOnCard: g.roleOnCard.trim().toLowerCase(),
    firstName: g.firstName.trim().toLowerCase(),
    lastName: g.lastName.trim().toLowerCase(),
    dateOfBirth: g.dateOfBirth,
    citizenship: g.citizenship?.trim().toUpperCase(),
    documentNumber: g.documentNumber?.trim().toUpperCase(),
  };
}

/**
 * Computes a per-card HMAC-SHA256 fingerprint for duplicate detection.
 * Uses a server-side pepper so the output is not guessable from document data alone.
 * The normalization is deterministic: same logical card → same fingerprint.
 */
export function computeCardFingerprint(card: CardFingerprintData, pepper: string): string {
  const normalized = {
    cardType: card.cardType.trim().toLowerCase(),
    // Sort guests by guestType + firstName + lastName for stability regardless of input order.
    guests: [...card.guests]
      .sort((a, b) => {
        const ka = `${a.guestType}|${a.firstName}|${a.lastName}|${a.dateOfBirth}`;
        const kb = `${b.guestType}|${b.firstName}|${b.lastName}|${b.dateOfBirth}`;
        return ka.localeCompare(kb);
      })
      .map(normalizeGuest),
  };
  const payload = JSON.stringify(normalized);
  return createHmac("sha256", pepper).update(payload, "utf8").digest("hex");
}
