import type { PayloadPerson } from "./submissionSchema.js";

export type PassengerCardDraft = {
  cardType: "PRIMARY_WITH_ALLOWED_FAMILY" | "ADDITIONAL_ADULT_INDIVIDUAL";
  signatureField: string;
  people: PayloadPerson[];
};

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}

/**
 * Pure function: groups validated people into PassengerCard drafts.
 *
 * Rules:
 * - Exactly one "primary" guest required (enforced by Zod; double-checked here).
 * - Primary + spouse + minor children → one PRIMARY_WITH_ALLOWED_FAMILY card.
 * - Each "additional_adult" (in input order) → a separate ADDITIONAL_ADULT_INDIVIDUAL card.
 * - Spouses and children must not appear without a primary on the same card.
 * - Family card may have at most 5 riders (spouse + children combined).
 */
export function buildPassengerCards(people: PayloadPerson[]): PassengerCardDraft[] {
  const primary = people.filter((p) => p.guestType === "primary");
  if (primary.length !== 1) {
    throw new DomainValidationError("Exactly one primary guest is required");
  }

  const familyRiders = people.filter(
    (p) => p.guestType === "spouse" || p.guestType === "child",
  );
  if (familyRiders.length > 5) {
    throw new DomainValidationError(
      "Primary card may have at most 5 family riders (spouse + children)",
    );
  }

  const additionalAdults = people.filter((p) => p.guestType === "additional_adult");

  const cards: PassengerCardDraft[] = [];

  // Card 1: primary + family
  cards.push({
    cardType: "PRIMARY_WITH_ALLOWED_FAMILY",
    signatureField: "signature_primary",
    people: [...primary, ...familyRiders],
  });

  // One card per additional adult, indexed 0-based.
  for (let i = 0; i < additionalAdults.length; i++) {
    cards.push({
      cardType: "ADDITIONAL_ADULT_INDIVIDUAL",
      signatureField: `signature_additionalAdult_${i}`,
      people: [additionalAdults[i]!],
    });
  }

  return cards;
}
