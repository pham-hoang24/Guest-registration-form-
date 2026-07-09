import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildTestApp,
  extractSessionCookie,
  seedFixtures,
  testDb,
  truncateAll,
  type TestFixtures,
} from "./helpers.js";

const { app } = buildTestApp();
let fx: TestFixtures;

/** Logs in an owner and returns both the raw session cookie and its CSRF token. */
async function loginCookie(email: string): Promise<{ cookie: string; csrfToken: string }> {
  const res = await request(app)
    .post("/v1/owner/auth/login")
    .send({ email, password: fx.password });
  expect(res.status).toBe(200);
  expect(typeof res.body.csrfToken).toBe("string");
  return { cookie: extractSessionCookie(res), csrfToken: res.body.csrfToken };
}

const newUser = () => ({
  email: `csrf-${Math.random().toString(36).slice(2)}@example.com`,
  password: "a-long-enough-password",
  role: "MANAGER" as const,
});

beforeEach(async () => {
  await truncateAll();
  fx = await seedFixtures();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("CSRF token issuance", () => {
  it("login returns a session-bound CSRF token", async () => {
    const { csrfToken } = await loginCookie(fx.ownerA.email);
    expect(csrfToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it("GET /me returns the CSRF token for a cookie session, null for a bearer session", async () => {
    const { cookie, csrfToken } = await loginCookie(fx.ownerA.email);

    const viaCookie = await request(app)
      .get("/v1/owner/auth/me")
      .set("cookie", `gr_owner_session=${cookie}`);
    expect(viaCookie.body.csrfToken).toBe(csrfToken);

    const viaBearer = await request(app)
      .get("/v1/owner/auth/me")
      .set("authorization", `Bearer ${cookie}`);
    expect(viaBearer.body.csrfToken).toBeNull();
  });
});

describe("CSRF enforcement on cookie-session mutations", () => {
  it("rejects a cookie mutation with no CSRF token (403 csrf_failed)", async () => {
    const { cookie } = await loginCookie(fx.ownerA.email);
    const res = await request(app)
      .post("/v1/owner/users")
      .set("cookie", `gr_owner_session=${cookie}`)
      .send(newUser());
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "csrf_failed" });
    expect(await testDb.ownerUser.count({ where: { tenantId: fx.tenantA.id } })).toBe(3);
  });

  it("rejects a cookie mutation with a wrong CSRF token", async () => {
    const { cookie } = await loginCookie(fx.ownerA.email);
    const res = await request(app)
      .post("/v1/owner/users")
      .set("cookie", `gr_owner_session=${cookie}`)
      .set("x-csrf-token", "0".repeat(64))
      .send(newUser());
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "csrf_failed" });
  });

  it("accepts a cookie mutation with the correct CSRF token", async () => {
    const { cookie, csrfToken } = await loginCookie(fx.ownerA.email);
    const res = await request(app)
      .post("/v1/owner/users")
      .set("cookie", `gr_owner_session=${cookie}`)
      .set("x-csrf-token", csrfToken)
      .send(newUser());
    expect(res.status).toBe(201);
  });

  it("does not require a CSRF token for a bearer-authenticated mutation", async () => {
    const { cookie } = await loginCookie(fx.ownerA.email);
    const res = await request(app)
      .post("/v1/owner/users")
      .set("authorization", `Bearer ${cookie}`)
      .send(newUser());
    expect(res.status).toBe(201);
  });

  it("guards logout too: cookie logout needs the CSRF token", async () => {
    const { cookie, csrfToken } = await loginCookie(fx.ownerA.email);

    const denied = await request(app)
      .post("/v1/owner/auth/logout")
      .set("cookie", `gr_owner_session=${cookie}`);
    expect(denied.status).toBe(403);

    const ok = await request(app)
      .post("/v1/owner/auth/logout")
      .set("cookie", `gr_owner_session=${cookie}`)
      .set("x-csrf-token", csrfToken);
    expect(ok.status).toBe(204);
  });
});
