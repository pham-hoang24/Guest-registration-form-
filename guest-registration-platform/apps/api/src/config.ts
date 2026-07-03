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
};

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const jwtSecret = env.JWT_SECRET ?? "dev_change_me";
  if (env.NODE_ENV === "production" && (jwtSecret === "dev_change_me" || jwtSecret.length < 32)) {
    throw new Error("JWT_SECRET must be a strong secret in production");
  }
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
  };
}
