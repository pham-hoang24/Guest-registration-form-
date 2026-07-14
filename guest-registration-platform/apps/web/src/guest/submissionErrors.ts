import type { TFunction } from "i18next";
import { ApiError } from "../api/client.js";

/** Maps public submission API error codes to guest-facing i18n keys. */
export function guestSubmissionErrorMessage(error: unknown, t: TFunction): string {
  if (!(error instanceof ApiError)) return t("status.errorGeneric");

  if (error.status === 404 || error.code === "registration_link_unavailable") {
    return t("status.errorLinkExpired");
  }

  switch (error.code) {
    case "validation_failed":
      return t("status.errorValidation");
    case "stay_fields_mismatch":
      return t("status.errorStayMismatch");
    case "missing_signature":
    case "invalid_signature_field":
    case "duplicate_signature_field":
    case "invalid_signature_format":
    case "signature_too_large":
      return t("status.errorSignatureInvalid");
    case "partial_duplicate_submission":
      return t("status.errorPartialDuplicate");
    case "max_passenger_cards_exceeded":
      return t("status.errorCapacityExceeded");
    case "internal_error":
      return t("status.errorServer");
    default:
      return t("status.errorGeneric");
  }
}
