import rateLimit, { type Store } from "express-rate-limit";
import type { RequestHandler } from "express";
import type { ApiConfig } from "../config.js";

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const ONE_MINUTE = 60 * 1000;

function noop(): RequestHandler {
  return (_req, _res, next) => next();
}

async function buildRedisStore(redisUrl: string): Promise<Store> {
  const { default: Redis } = await import("ioredis");
  const { RedisStore } = await import("rate-limit-redis");
  const client = new Redis(redisUrl, { lazyConnect: true });
  await client.connect();
  return new RedisStore({
    sendCommand: (...args: string[]) =>
      client.call(args[0]!, ...args.slice(1)) as Promise<number>,
  });
}

let _redisStore: Store | undefined;

async function getRedisStore(redisUrl: string): Promise<Store> {
  if (!_redisStore) {
    _redisStore = await buildRedisStore(redisUrl);
  }
  return _redisStore;
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

/**
 * Per-IP+token GET rate limit: 60 requests/minute.
 * Uses hashed token in the key so one token's traffic doesn't bleed into another.
 */
export function publicGetRateLimit(config: ApiConfig, hashedToken: string): RequestHandler {
  if (!config.rateLimitEnabled) return noop();
  return rateLimit({
    windowMs: ONE_MINUTE,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests" },
    keyGenerator: (req) => `${req.ip ?? "unknown"}:${hashedToken}`,
  });
}

/**
 * Per-IP+token POST rate limit: 5 requests/minute.
 */
export function publicPostRateLimit(config: ApiConfig, hashedToken: string): RequestHandler {
  if (!config.rateLimitEnabled) return noop();
  return rateLimit({
    windowMs: ONE_MINUTE,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests" },
    keyGenerator: (req) => `${req.ip ?? "unknown"}:${hashedToken}`,
  });
}

/**
 * Per-token hourly POST rate limit: 20 requests/hour (across all IPs).
 * Primary defense against one link being spammed across rotating IPs.
 */
export function publicPostHourlyRateLimit(
  config: ApiConfig,
  hashedToken: string,
): RequestHandler {
  if (!config.rateLimitEnabled) return noop();
  return rateLimit({
    windowMs: ONE_HOUR,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests" },
    keyGenerator: () => hashedToken,
  });
}

/** @deprecated Use publicGetRateLimit / publicPostRateLimit with per-token keys. */
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

export { getRedisStore };
