import type { Response } from "express";

/** Error responses use { error: "snake_case_code" }; no internals, no PII. */
export function sendError(
  res: Response,
  status: number,
  code: string,
  details?: unknown,
): void {
  res.status(status).json(details === undefined ? { error: code } : { error: code, details });
}
