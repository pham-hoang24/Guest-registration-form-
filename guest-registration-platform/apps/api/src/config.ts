import { ACTIVE_FORM_REQUIREMENT_VERSION } from "@gr/shared";

/** Hosts that must never front a production public URL (SSRF / capability-URL leakage). */
function isDisallowedProdHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "127.0.0.1" || h.startsWith("127.") || h === "::1" || h === "[::1]") return true;
  if (h === "0.0.0.0") return true;
  // RFC 1918 / link-local / unique-local private ranges.
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h) || h.startsWith("[fc") || h.startsWith("[fd")) return true;
  return false;
}

/**
 * PUBLIC_APP_URL is the origin of the secret registration capability URLs, so a
 * misconfiguration is a security bug, not a cosmetic one. It must parse, and in
 * production it must be an external HTTPS origin — never http, localhost, or a
 * private/link-local host.
 */
function validatePublicAppUrl(raw: string, isProd: boolean): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("PUBLIC_APP_URL must be a valid absolute URL");
  }
  if (isProd) {
    if (url.protocol !== "https:") {
      throw new Error("PUBLIC_APP_URL must use https in production");
    }
    if (isDisallowedProdHost(url.hostname)) {
      throw new Error("PUBLIC_APP_URL must be a public host in production (no localhost/private IP)");
    }
  }
  return raw;
}

export type ApiConfig = {
  port: number;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  jwtExpiresIn: string;
  /** When set, owner tokens are verified via RS256/JWKS instead of HS256. Must be https. */
  ownerJwksUri: string | undefined;
  /** Whether the Authorization: Bearer header is accepted for owner auth (cookie is always accepted). */
  allowBearerOwnerAuth: boolean;
  ownerAuthCookieName: string;
  /** Sets the `secure` attribute on the owner session cookie. */
  ownerCookieSecure: boolean;
  publicAppUrl: string;
  retentionDefaultDays: number;
  /** Grace period between retainUntil and hard deletion. */
  retentionGraceDays: number;
  rateLimitEnabled: boolean;
  /** HMAC pepper for card fingerprints. Required in production. */
  fingerprintPepper: string;
  /** Redis connection URL. Required in production for distributed rate limiting. */
  redisUrl: string | undefined;
  /**
   * Value passed to express `trust proxy`. Set to `1` when behind exactly one
   * trusted reverse proxy/load-balancer. Leave `false` (default) for direct connections.
   */
  trustProxy: number | boolean;
};

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const jwtSecret = env.JWT_SECRET ?? "dev_change_me";
  if (env.NODE_ENV === "production" && (jwtSecret === "dev_change_me" || jwtSecret.length < 32)) {
    throw new Error("JWT_SECRET must be a strong secret in production");
  }

  const fingerprintPepper = env.FINGERPRINT_PEPPER ?? "dev_fingerprint_pepper_change_me";
  if (
    env.NODE_ENV === "production" &&
    (fingerprintPepper === "dev_fingerprint_pepper_change_me" || fingerprintPepper.length < 32)
  ) {
    throw new Error("FINGERPRINT_PEPPER must be a strong secret (≥32 chars) in production");
  }

  const redisUrl = env.REDIS_URL;
  if (env.NODE_ENV === "production" && !redisUrl) {
    throw new Error("REDIS_URL is required in production for distributed rate limiting");
  }

  const ownerJwksUri = env.OWNER_JWKS_URI;

  const isProd = env.NODE_ENV === "production";
  const allowBearerOwnerAuth = env.ALLOW_BEARER_OWNER_AUTH
    ? env.ALLOW_BEARER_OWNER_AUTH === "true"
    : !isProd;

  if (
    env.OWNER_COOKIE_SECURE !== undefined &&
    env.OWNER_COOKIE_SECURE !== "true" &&
    env.OWNER_COOKIE_SECURE !== "false"
  ) {
    throw new Error('OWNER_COOKIE_SECURE must be "true" or "false"');
  }
  // In production the cookie is always secure — the env var can only opt in to
  // secure=true outside production (e.g. an HTTPS-fronted staging box), never
  // opt out of secure=true in production.
  const ownerCookieSecure = isProd || env.OWNER_COOKIE_SECURE === "true";

  const rawTrustProxy = env.TRUST_PROXY;
  let trustProxy: number | boolean = false;
  if (rawTrustProxy === "1") trustProxy = 1;
  else if (rawTrustProxy === "true") trustProxy = true;

  const publicAppUrl = validatePublicAppUrl(env.PUBLIC_APP_URL ?? "http://localhost:5173", isProd);

  // Fail closed on legal status: the active requirement version must be
  // LEGAL_APPROVED unless explicitly waived. The waiver defaults ON in
  // production, so shipping a draft template requires a deliberate opt-out
  // (REQUIRE_LEGAL_APPROVED_REQUIREMENTS=false), never silence.
  const requireLegalApproved = env.REQUIRE_LEGAL_APPROVED_REQUIREMENTS
    ? env.REQUIRE_LEGAL_APPROVED_REQUIREMENTS === "true"
    : isProd;
  if (
    requireLegalApproved &&
    ACTIVE_FORM_REQUIREMENT_VERSION.reviewStatus !== "LEGAL_APPROVED"
  ) {
    throw new Error(
      `Active form requirement ${ACTIVE_FORM_REQUIREMENT_VERSION.id} is ` +
        `${ACTIVE_FORM_REQUIREMENT_VERSION.reviewStatus}, not LEGAL_APPROVED. ` +
        "Set REQUIRE_LEGAL_APPROVED_REQUIREMENTS=false to run on a draft template.",
    );
  }

  return {
    port: Number(env.PORT ?? 3000),
    jwtSecret,
    jwtIssuer: env.JWT_ISSUER ?? "guest-registration-platform",
    jwtAudience: env.JWT_AUDIENCE ?? "owner-dashboard",
    jwtExpiresIn: env.JWT_EXPIRES_IN ?? "4h",
    ownerJwksUri,
    allowBearerOwnerAuth,
    ownerAuthCookieName: env.OWNER_COOKIE_NAME ?? "gr_owner_session",
    ownerCookieSecure,
    publicAppUrl,
    retentionDefaultDays: Number(env.RETENTION_DEFAULT_DAYS ?? 365),
    retentionGraceDays: 30,
    rateLimitEnabled: env.NODE_ENV !== "test",
    fingerprintPepper,
    redisUrl,
    trustProxy,
  };
}
