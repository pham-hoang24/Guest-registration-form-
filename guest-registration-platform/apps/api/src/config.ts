export type ApiConfig = {
  port: number;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  jwtExpiresIn: string;
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

  const rawTrustProxy = env.TRUST_PROXY;
  let trustProxy: number | boolean = false;
  if (rawTrustProxy === "1") trustProxy = 1;
  else if (rawTrustProxy === "true") trustProxy = true;

  return {
    port: Number(env.PORT ?? 3000),
    jwtSecret,
    jwtIssuer: env.JWT_ISSUER ?? "guest-registration-platform",
    jwtAudience: env.JWT_AUDIENCE ?? "owner-dashboard",
    jwtExpiresIn: "12h",
    publicAppUrl: env.PUBLIC_APP_URL ?? "http://localhost:5173",
    retentionDefaultDays: Number(env.RETENTION_DEFAULT_DAYS ?? 365),
    retentionGraceDays: 30,
    rateLimitEnabled: env.NODE_ENV !== "test",
    fingerprintPepper,
    redisUrl,
    trustProxy,
  };
}
