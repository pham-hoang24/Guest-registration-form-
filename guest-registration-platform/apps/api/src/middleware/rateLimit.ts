import rateLimit, { type Store } from "express-rate-limit";
import type { RequestHandler } from "express";
import { hashRegistrationToken } from "@gr/crypto";
import type { ApiConfig } from "../config.js";

const MAX_TOKEN_LENGTH_FOR_KEY = 512;

function hashTokenParam(req: { params: Record<string, string> }): string {
  const rawToken = typeof req.params.token === "string" ? req.params.token : "";
  return hashRegistrationToken(rawToken.slice(0, MAX_TOKEN_LENGTH_FOR_KEY));
}

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
 * Built once per router (not per request) so the store — in-memory or Redis —
 * actually accumulates counts across requests. Distributed via Redis when `store`
 * is provided (see `buildRedisRateLimitStore`).
 */
export function publicGetRateLimit(config: ApiConfig, store?: Store): RequestHandler {
  if (!config.rateLimitEnabled) return noop();
  return rateLimit({
    windowMs: ONE_MINUTE,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests" },
    keyGenerator: (req) => `${req.ip ?? "unknown"}:${hashTokenParam(req)}`,
    ...(store ? { store } : {}),
  });
}

/**
 * Per-IP+token POST rate limit: 5 requests/minute.
 * Built once per router — see `publicGetRateLimit` doc comment.
 */
export function publicPostRateLimit(config: ApiConfig, store?: Store): RequestHandler {
  if (!config.rateLimitEnabled) return noop();
  return rateLimit({
    windowMs: ONE_MINUTE,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests" },
    keyGenerator: (req) => `${req.ip ?? "unknown"}:${hashTokenParam(req)}`,
    ...(store ? { store } : {}),
  });
}

/**
 * Per-token hourly POST rate limit: 20 requests/hour (across all IPs).
 * Primary defense against one link being spammed across rotating IPs.
 * Built once per router — see `publicGetRateLimit` doc comment.
 */
export function publicPostHourlyRateLimit(config: ApiConfig, store?: Store): RequestHandler {
  if (!config.rateLimitEnabled) return noop();
  return rateLimit({
    windowMs: ONE_HOUR,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests" },
    keyGenerator: (req) => hashTokenParam(req),
    ...(store ? { store } : {}),
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
