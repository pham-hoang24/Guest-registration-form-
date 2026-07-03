import rateLimit from "express-rate-limit";
import type { RequestHandler } from "express";
import type { ApiConfig } from "../config.js";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function noop(): RequestHandler {
  return (_req, _res, next) => next();
}

/** Brute-force protection for owner login. */
export function loginRateLimit(config: ApiConfig): RequestHandler {
  if (!config.rateLimitEnabled) return noop();
  return rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests" },
  });
}

/** Throttles registration-token guessing and submission spam. */
export function publicRateLimit(config: ApiConfig): RequestHandler {
  if (!config.rateLimitEnabled) return noop();
  return rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests" },
  });
}
