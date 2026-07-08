import rateLimit, { type Store } from "express-rate-limit";
import type { RequestHandler } from "express";
import type { ApiConfig } from "../config.js";

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const ONE_MINUTE = 60 * 1000;

function noop(): RequestHandler {
  return (_req, _res, next) => next();
}

let _redisClient: import("ioredis").Redis | undefined;

async function getRedisClient(redisUrl: string): Promise<import("ioredis").Redis> {
  if (!_redisClient) {
    const { default: Redis } = await import("ioredis");
    const client = new Redis(redisUrl, { lazyConnect: true });
    // A blip after startup should log, not crash an in-flight request.
    client.on("error", (error) => {
      console.error(
        JSON.stringify({ level: "error", event: "redis_rate_limit_error", error: error.name }),
      );
    });
    await client.connect();
    _redisClient = client;
  }
  return _redisClient;
}

/**
 * Builds a Redis-backed rate-limit store. `prefix` gives each limiter its own
 * key namespace so their counters don't collide in shared Redis. Verifies the
 * connection (via `connect()`) so a misconfigured Redis fails startup loudly
 * instead of degrading silently to per-process limits.
 */
export async function buildRedisRateLimitStore(redisUrl: string, prefix: string): Promise<Store> {
  const client = await getRedisClient(redisUrl);
  const { RedisStore } = await import("rate-limit-redis");
  return new RedisStore({
    prefix,
    sendCommand: (...args: string[]) => client.call(args[0]!, ...args.slice(1)) as Promise<number>,
  });
}

/** Brute-force protection for owner login. Distributed via Redis when `store` is provided. */
export function loginRateLimit(config: ApiConfig, store?: Store): RequestHandler {
  if (!config.rateLimitEnabled) return noop();
  return rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests" },
    ...(store ? { store } : {}),
  });
}

/**
 * Per-IP+token GET rate limit: 60 requests/minute.
 * Uses hashed token in the key so one token's traffic doesn't bleed into another.
 * Per-process (in-memory) for now — see docs/threat-model.md.
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
 * Per-process (in-memory) for now — see docs/threat-model.md.
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
 * Per-process (in-memory) for now — see docs/threat-model.md.
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
