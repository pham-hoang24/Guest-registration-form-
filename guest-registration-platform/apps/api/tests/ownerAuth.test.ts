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

beforeEach(async () => {
  await truncateAll();
  fx = await seedFixtures();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("POST /v1/owner/auth/login", () => {
  it("logs in with valid credentials, sets a hardened session cookie, and audits it", async () => {
    const res = await request(app)
      .post("/v1/owner/auth/login")
      .send({ email: fx.ownerA.email, password: fx.password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
    expect(res.body.user).toEqual({
      id: fx.ownerA.id,
      email: fx.ownerA.email,
      role: "OWNER",
      tenantId: fx.tenantA.id,
    });
    expect(res.headers["cache-control"]).toBe("no-store");

    const setCookie = res.headers["set-cookie"] as unknown as string[];
    const cookie = setCookie.find((c) => c.startsWith("gr_owner_session="))!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Domain=");
    // NODE_ENV=test → ownerCookieSecure is false; the attribute must be absent.
    expect(cookie).not.toContain("Secure");

    const audit = await testDb.auditLog.findFirst({
      where: { action: "OWNER_LOGIN_SUCCEEDED", actorId: fx.ownerA.id },
    });
    expect(audit).not.toBeNull();
  });

  it("returns the same generic error for wrong password and unknown email", async () => {
    const wrongPassword = await request(app)
      .post("/v1/owner/auth/login")
      .send({ email: fx.ownerA.email, password: "wrong" });
    const unknownEmail = await request(app)
      .post("/v1/owner/auth/login")
      .send({ email: "nobody@example.com", password: "wrong" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body).toEqual({ error: "invalid_credentials" });

    const failures = await testDb.auditLog.count({ where: { action: "OWNER_LOGIN_FAILED" } });
    expect(failures).toBe(2);
  });

  it("rejects disabled users", async () => {
    await testDb.ownerUser.update({ where: { id: fx.ownerA.id }, data: { status: "DISABLED" } });
    const res = await request(app)
      .post("/v1/owner/auth/login")
      .send({ email: fx.ownerA.email, password: fx.password });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid_credentials" });
  });
});

describe("POST /v1/owner/auth/logout", () => {
  it("clears the session cookie and sets no-store", async () => {
    const res = await request(app).post("/v1/owner/auth/logout");
    expect(res.status).toBe(204);
    expect(res.headers["cache-control"]).toBe("no-store");
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    const cookie = setCookie.find((c) => c.startsWith("gr_owner_session="))!;
    expect(cookie).toMatch(/gr_owner_session=;/);
  });
});

describe("GET /v1/owner/auth/me", () => {
  it("works via the session cookie", async () => {
    const login = await request(app)
      .post("/v1/owner/auth/login")
      .send({ email: fx.viewerA.email, password: fx.password });
    const cookie = extractSessionCookie(login);
    const res = await request(app)
      .get("/v1/owner/auth/me")
      .set("cookie", `gr_owner_session=${cookie}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("VIEWER");
    expect(res.body.tenantId).toBe(fx.tenantA.id);
  });

  it("works via Bearer header (allowed by default outside production)", async () => {
    const login = await request(app)
      .post("/v1/owner/auth/login")
      .send({ email: fx.viewerA.email, password: fx.password });
    const token = extractSessionCookie(login);
    const res = await request(app)
      .get("/v1/owner/auth/me")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("VIEWER");
  });

  it("rejects both cookie and Bearer present at once", async () => {
    const login = await request(app)
      .post("/v1/owner/auth/login")
      .send({ email: fx.viewerA.email, password: fx.password });
    const token = extractSessionCookie(login);
    const res = await request(app)
      .get("/v1/owner/auth/me")
      .set("cookie", `gr_owner_session=${token}`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "ambiguous_auth" });
  });

  it("rejects missing or garbage tokens", async () => {
    expect((await request(app).get("/v1/owner/auth/me")).status).toBe(401);
    expect(
      (await request(app).get("/v1/owner/auth/me").set("authorization", "Bearer junk")).status,
    ).toBe(401);
  });
});
