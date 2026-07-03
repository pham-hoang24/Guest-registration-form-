import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, seedFixtures, testDb, truncateAll, type TestFixtures } from "./helpers.js";

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
  it("logs in with valid credentials and audits it", async () => {
    const res = await request(app)
      .post("/v1/owner/auth/login")
      .send({ email: fx.ownerA.email, password: fx.password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toEqual({
      id: fx.ownerA.id,
      email: fx.ownerA.email,
      role: "OWNER",
      tenantId: fx.tenantA.id,
    });

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

describe("GET /v1/owner/auth/me", () => {
  it("returns the authenticated user", async () => {
    const login = await request(app)
      .post("/v1/owner/auth/login")
      .send({ email: fx.viewerA.email, password: fx.password });
    const res = await request(app)
      .get("/v1/owner/auth/me")
      .set("authorization", `Bearer ${login.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("VIEWER");
    expect(res.body.tenantId).toBe(fx.tenantA.id);
  });

  it("rejects missing or garbage tokens", async () => {
    expect((await request(app).get("/v1/owner/auth/me")).status).toBe(401);
    expect(
      (await request(app).get("/v1/owner/auth/me").set("authorization", "Bearer junk")).status,
    ).toBe(401);
  });
});
