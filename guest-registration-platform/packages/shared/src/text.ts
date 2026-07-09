import { z } from "zod";

/**
 * Shared text handling for user-entered names / address / document number / PIC.
 *
 * The real protection against injection is text-only rendering everywhere (React
 * escaping, pdf-lib drawText) — never `dangerouslySetInnerHTML` for user data.
 * These checks are DEFENSE IN DEPTH: normalize + validate + length-limit at the
 * trust boundary so control characters and obvious script/URL payloads never
 * reach storage, encryption, or the PDF.
 */

// C0/C1 control chars that must never appear in a name or address. Normal
// whitespace (space, tab, newline) is collapsed by normalizeText before this
// runs, so anything matched here is a genuine control character.
// eslint-disable-next-line no-control-regex -- rejecting control chars is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const DANGEROUS = /<script|javascript:|data:text\/html/i;

/** Trim, Unicode NFC-normalize, and collapse internal whitespace runs to one space. */
export function normalizeText(input: string): string {
  return input.normalize("NFC").replace(/\s+/g, " ").trim();
}

/**
 * A Zod string that is normalized, rejected on control chars / obvious script
 * payloads, then length-limited. Use for every free-text guest field.
 */
export function normalizedString(opts: { max: number; min?: number }) {
  const min = opts.min ?? 1;
  return z
    .string()
    .transform((value) => normalizeText(value))
    .superRefine((value, ctx) => {
      if (CONTROL_CHARS.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Must not contain control characters",
        });
      }
      if (DANGEROUS.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Must not contain disallowed content",
        });
      }
    })
    .pipe(z.string().min(min).max(opts.max));
}
