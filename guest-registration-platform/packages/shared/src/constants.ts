/**
 * Compliance requirement version stamped on every submission and bound into
 * the PDF encryption AAD.
 *
 * TODO(legal): "FI-ACCOMMODATION-2026-01" is a working placeholder. The exact
 * field set and retention rules for Finnish accommodation registration
 * (majoitusilmoitus, Act on Accommodation and Catering Operations 308/2006)
 * MUST be verified against official sources before production use.
 */
export const REQUIREMENT_VERSION = "FI-ACCOMMODATION-2026-01";

export const SUPPORTED_LANGUAGES = ["en", "fi", "sv"] as const;

export const DOCUMENT_TYPES = ["passport", "id_card", "residence_permit", "other"] as const;

export const PURPOSES_OF_STAY = ["Leisure", "Business", "Meeting", "Other"] as const;
