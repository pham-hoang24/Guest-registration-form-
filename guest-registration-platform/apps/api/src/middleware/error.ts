import type { NextFunction, Request, Response } from "express";
import { sendError } from "../lib/httpErrors.js";

/**
 * Terminal error handler. Logs only the error name/message and request id —
 * never request bodies (guest PII) or stack-embedded values in responses.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const message = err instanceof Error ? err.message : "unknown";
  console.error(
    JSON.stringify({
      level: "error",
      requestId: req.requestId,
      error: err instanceof Error ? err.name : "UnknownError",
      message,
    }),
  );
  if (res.headersSent) {
    res.end();
    return;
  }
  sendError(res, 500, "internal_error");
}
