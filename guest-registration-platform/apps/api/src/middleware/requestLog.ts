import type { NextFunction, Request, Response } from "express";

/**
 * No-PII request logging: method, route, status, duration, request id.
 * Never log bodies, query strings, tokens, or headers — guest routes carry
 * personal data and registration tokens in the URL path.
 */
export function requestLog(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV === "test") {
    next();
    return;
  }
  const start = Date.now();
  res.on("finish", () => {
    const route = redactPath(req.path);
    console.log(
      JSON.stringify({
        level: "info",
        requestId: req.requestId,
        method: req.method,
        path: route,
        status: res.statusCode,
        durationMs: Date.now() - start,
      }),
    );
  });
  next();
}

/** Registration tokens appear in public URL paths — redact them. */
function redactPath(path: string): string {
  return path.replace(
    /(\/v1\/public\/registration-links\/)[^/]+/,
    "$1[redacted-token]",
  );
}
