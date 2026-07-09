import { describe, expect, it } from "vitest";
import { ACTIVE_FORM_REQUIREMENT_VERSION } from "@gr/shared";
import { configFromEnv } from "../src/config.js";

/** A production env that passes every guard EXCEPT whatever a test overrides. */
const prodEnv = (overrides: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: "production",
  JWT_SECRET: "x".repeat(40),
  FINGERPRINT_PEPPER: "y".repeat(40),
  REDIS_URL: "redis://cache:6379",
  PUBLIC_APP_URL: "https://guests.example.com",
  // Draft template is the shipped default, so waive the legal gate unless a test asserts it.
  REQUIRE_LEGAL_APPROVED_REQUIREMENTS: "false",
  ...overrides,
});

describe("PUBLIC_APP_URL validation", () => {
  it("rejects an unparseable URL", () => {
    expect(() => configFromEnv({ NODE_ENV: "development", PUBLIC_APP_URL: "not a url" })).toThrow(
      /PUBLIC_APP_URL/,
    );
  });

  it("rejects http in production", () => {
    expect(() => configFromEnv(prodEnv({ PUBLIC_APP_URL: "http://guests.example.com" }))).toThrow(
      /https/,
    );
  });

  it.each(["https://localhost:5173", "https://127.0.0.1", "https://10.1.2.3", "https://192.168.0.9"])(
    "rejects the private/local host %s in production",
    (url) => {
      expect(() => configFromEnv(prodEnv({ PUBLIC_APP_URL: url }))).toThrow(/public host/);
    },
  );

  it("accepts a public https origin in production", () => {
    const config = configFromEnv(prodEnv());
    expect(config.publicAppUrl).toBe("https://guests.example.com");
  });

  it("allows http://localhost outside production", () => {
    const config = configFromEnv({ NODE_ENV: "development" });
    expect(config.publicAppUrl).toBe("http://localhost:5173");
  });
});

describe("legal-approval gate", () => {
  // Guard-rail for the whole slice: the shipped template is a draft, so the gate
  // must actually fire when required. If a future version is LEGAL_APPROVED this
  // assertion documents that the gate no longer trips — update deliberately.
  it("the active requirement version ships as a draft (not LEGAL_APPROVED)", () => {
    expect(ACTIVE_FORM_REQUIREMENT_VERSION.reviewStatus).not.toBe("LEGAL_APPROVED");
  });

  it("rejects a non-approved active version when the requirement is enforced", () => {
    expect(() =>
      configFromEnv(prodEnv({ REQUIRE_LEGAL_APPROVED_REQUIREMENTS: "true" })),
    ).toThrow(/LEGAL_APPROVED/);
  });

  it("defaults the gate ON in production (draft ⇒ refuses to start)", () => {
    // Same as prodEnv but WITHOUT the explicit waiver — production must fail closed.
    const env = prodEnv();
    delete env.REQUIRE_LEGAL_APPROVED_REQUIREMENTS;
    expect(() => configFromEnv(env)).toThrow(/LEGAL_APPROVED/);
  });

  it("runs on the draft when the gate is explicitly waived", () => {
    const config = configFromEnv(prodEnv({ REQUIRE_LEGAL_APPROVED_REQUIREMENTS: "false" }));
    expect(config.jwtSecret).toBe("x".repeat(40));
  });

  it("does not enforce the gate outside production by default", () => {
    expect(() => configFromEnv({ NODE_ENV: "development" })).not.toThrow();
  });
});
