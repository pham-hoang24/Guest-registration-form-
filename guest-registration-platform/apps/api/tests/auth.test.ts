import { generateKeyPairSync } from "node:crypto";
import request from "supertest";
import jwt from "jsonwebtoken";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearJwksCacheForTests } from "../src/middleware/auth.js";
import { buildTestAppWithEnv, seedFixtures, testDb, truncateAll, type TestFixtures } from "./helpers.js";

const JWKS_URI = "https://idp.example.test/.well-known/jwks.json";
const KID = "test-key-1";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;

function jwksResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ keys: [{ ...jwk, kid: KID, use: "sig", alg: "RS256", ...overrides }] }),
  };
}

function signRs256(claims: Record<string, unknown>, options: jwt.SignOptions = {}): string {
  const { sub, ...rest } = claims;
  return jwt.sign(rest, privateKey, {
    algorithm: "RS256",
    subject: sub as string,
    issuer: "guest-registration-platform",
    audience: "owner-dashboard",
    expiresIn: "1h",
    keyid: KID,
    ...options,
  });
}

let fx: TestFixtures;

beforeEach(async () => {
  await truncateAll();
  fx = await seedFixtures();
  clearJwksCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("RS256/JWKS owner auth (OWNER_JWKS_URI set)", () => {
  it("accepts a valid RS256 token verified against the JWKS", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jwksResponse()));
    const { app } = buildTestAppWithEnv({ OWNER_JWKS_URI: JWKS_URI });

    const token = signRs256({ tenantId: fx.ownerA.tenantId, role: "OWNER", sub: fx.ownerA.id });
    const res = await request(app).get("/v1/owner/auth/me").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(fx.ownerA.id);
  });

  it("rejects an HS256 token even with a valid JWT_SECRET (no downgrade fallback)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jwksResponse()));
    const { app, deps } = buildTestAppWithEnv({ OWNER_JWKS_URI: JWKS_URI });

    const hs256Token = jwt.sign(
      { tenantId: fx.ownerA.tenantId, role: "OWNER" },
      deps.config.jwtSecret,
      {
        subject: fx.ownerA.id,
        issuer: deps.config.jwtIssuer,
        audience: deps.config.jwtAudience,
        algorithm: "HS256",
      },
    );
    const res = await request(app)
      .get("/v1/owner/auth/me")
      .set("authorization", `Bearer ${hs256Token}`);
    expect(res.status).toBe(401);
  });

  it("rejects a token with the wrong issuer or audience", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jwksResponse()));
    const { app } = buildTestAppWithEnv({ OWNER_JWKS_URI: JWKS_URI });

    const wrongIssuer = signRs256(
      { tenantId: fx.ownerA.tenantId, role: "OWNER", sub: fx.ownerA.id },
      { issuer: "someone-else" },
    );
    const wrongAudience = signRs256(
      { tenantId: fx.ownerA.tenantId, role: "OWNER", sub: fx.ownerA.id },
      { audience: "someone-else" },
    );
    expect(
      (await request(app).get("/v1/owner/auth/me").set("authorization", `Bearer ${wrongIssuer}`))
        .status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .get("/v1/owner/auth/me")
          .set("authorization", `Bearer ${wrongAudience}`)
      ).status,
    ).toBe(401);
  });

  it("returns 500 misconfigured_auth when OWNER_JWKS_URI is not https", async () => {
    const { app } = buildTestAppWithEnv({ OWNER_JWKS_URI: "http://idp.example.test/jwks.json" });
    const res = await request(app)
      .get("/v1/owner/auth/me")
      .set("authorization", "Bearer whatever");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "misconfigured_auth" });
  });

  it("fails closed (401) when the JWKS fetch fails and no cache exists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { app } = buildTestAppWithEnv({ OWNER_JWKS_URI: JWKS_URI });

    const token = signRs256({ tenantId: fx.ownerA.tenantId, role: "OWNER", sub: fx.ownerA.id });
    const res = await request(app).get("/v1/owner/auth/me").set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

describe("HS256 owner auth (OWNER_JWKS_URI unset)", () => {
  it("still verifies HS256 tokens as before", async () => {
    const { app } = buildTestAppWithEnv({});
    const login = await request(app)
      .post("/v1/owner/auth/login")
      .send({ email: fx.ownerA.email, password: fx.password });
    expect(login.status).toBe(200);
  });

  it("rejects the Bearer header when ALLOW_BEARER_OWNER_AUTH=false", async () => {
    const { app } = buildTestAppWithEnv({ ALLOW_BEARER_OWNER_AUTH: "false" });
    const login = await request(app)
      .post("/v1/owner/auth/login")
      .send({ email: fx.ownerA.email, password: fx.password });
    const setCookie = login.headers["set-cookie"] as unknown as string[];
    const token = setCookie
      .find((c) => c.startsWith("gr_owner_session="))!
      .split(";")[0]!
      .slice("gr_owner_session=".length);

    const viaBearer = await request(app)
      .get("/v1/owner/auth/me")
      .set("authorization", `Bearer ${token}`);
    expect(viaBearer.status).toBe(401);

    const viaCookie = await request(app)
      .get("/v1/owner/auth/me")
      .set("cookie", `gr_owner_session=${token}`);
    expect(viaCookie.status).toBe(200);
  });
});

describe("CORS", () => {
  it("sets Access-Control-Allow-Credentials and echoes the configured origin only", async () => {
    const { app, deps } = buildTestAppWithEnv({});
    const res = await request(app)
      .get("/v1/owner/auth/me")
      .set("origin", deps.config.publicAppUrl);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["access-control-allow-origin"]).toBe(deps.config.publicAppUrl);
  });
});
