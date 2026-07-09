// REQUIREMENT_VERSION now lives with the requirement engine — it IS the active
// FormRequirementVersion id. See ./form-requirements/temPassengerCard.v1.ts.

export const SUPPORTED_LANGUAGES = ["en", "fi", "sv"] as const;

export const DOCUMENT_TYPES = ["passport", "id_card", "residence_permit", "other"] as const;

export const PURPOSES_OF_STAY = ["Leisure", "Business", "Meeting", "Other"] as const;

export const GUEST_TYPES = ["primary", "spouse", "child", "additional_adult"] as const;

export const PASSENGER_CARD_PERSON_ROLES = ["CARD_HOLDER", "SPOUSE", "MINOR_CHILD"] as const;

/** Citizenships that exempt a card holder from the country-of-entry requirement. */
export const NORDIC_CITIZENSHIPS = ["FI", "SE", "NO", "DK", "IS"] as const;
