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

async function loginAs(email: string): Promise<string> {
  const res = await request(app)
    .post("/v1/owner/auth/login")
    .send({ email, password: fx.password });
  expect(res.status).toBe(200);
  return extractSessionCookie(res);
}

beforeEach(async () => {
  await truncateAll();
  fx = await seedFixtures();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("owner-users RBAC", () => {
  it("OWNER can list and create owner users, and it audits the creation", async () => {
    const token = await loginAs(fx.ownerA.email);

    const list = await request(app)
      .get("/v1/owner/users")
      .set("authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.users).toHaveLength(3); // ownerA, managerA, viewerA

    const created = await request(app)
      .post("/v1/owner/users")
      .set("authorization", `Bearer ${token}`)
      .send({ email: "new-manager@example.com", password: "a-long-enough-password", role: "MANAGER" });
    expect(created.status).toBe(201);
    expect(created.body.email).toBe("new-manager@example.com");

    const audit = await testDb.auditLog.findFirst({
      where: { action: "OWNER_USER_CREATED", resourceId: created.body.id },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(fx.ownerA.id);
  });

  it.each(["managerA", "viewerA"] as const)(
    "%s is forbidden from owner-users routes and it audits an unauthorized attempt",
    async (userKey) => {
      const token = await loginAs(fx[userKey].email);
      const res = await request(app)
        .get("/v1/owner/users")
        .set("authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "forbidden" });

      const audit = await testDb.auditLog.findFirst({
        where: { action: "UNAUTHORIZED_ACCESS_ATTEMPT" },
      });
      expect(audit).not.toBeNull();
      expect(audit!.actorId).toBe(fx[userKey].id);
    },
  );
});

describe("owner-users last-active-OWNER protection", () => {
  it("cannot demote the sole active OWNER", async () => {
    const token = await loginAs(fx.ownerA.email);
    const res = await request(app)
      .patch(`/v1/owner/users/${fx.ownerA.id}/role`)
      .set("authorization", `Bearer ${token}`)
      .send({ role: "MANAGER" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "last_active_owner" });

    const stillOwner = await testDb.ownerUser.findUnique({ where: { id: fx.ownerA.id } });
    expect(stillOwner!.role).toBe("OWNER");
    expect(stillOwner!.status).toBe("ACTIVE");
  });

  it("cannot disable the sole active OWNER", async () => {
    const token = await loginAs(fx.ownerA.email);
    const res = await request(app)
      .post(`/v1/owner/users/${fx.ownerA.id}/disable`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "last_active_owner" });

    const stillActive = await testDb.ownerUser.findUnique({ where: { id: fx.ownerA.id } });
    expect(stillActive!.status).toBe("ACTIVE");
  });

  it("allows demoting an OWNER when another active OWNER remains, and audits it", async () => {
    const token = await loginAs(fx.ownerA.email);
    const second = await testDb.ownerUser.create({
      data: {
        tenantId: fx.tenantA.id,
        email: "second-owner@example.com",
        passwordHash: fx.ownerA.passwordHash,
        role: "OWNER",
      },
    });

    const res = await request(app)
      .patch(`/v1/owner/users/${second.id}/role`)
      .set("authorization", `Bearer ${token}`)
      .send({ role: "MANAGER" });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("MANAGER");

    const audit = await testDb.auditLog.findFirst({
      where: { action: "OWNER_USER_ROLE_CHANGED", resourceId: second.id },
    });
    expect(audit).not.toBeNull();
  });
});

describe("owner-users duplicate email", () => {
  it("409 when creating a user with an existing email", async () => {
    const token = await loginAs(fx.ownerA.email);
    const res = await request(app)
      .post("/v1/owner/users")
      .set("authorization", `Bearer ${token}`)
      .send({ email: fx.ownerA.email, password: "a-long-enough-password", role: "VIEWER" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "email_already_exists" });
  });
});

describe("owner-users disable/enable audit", () => {
  it("disabling a non-owner user succeeds and audits OWNER_USER_DISABLED", async () => {
    const token = await loginAs(fx.ownerA.email);
    const res = await request(app)
      .post(`/v1/owner/users/${fx.managerA.id}/disable`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);

    const audit = await testDb.auditLog.findFirst({
      where: { action: "OWNER_USER_DISABLED", resourceId: fx.managerA.id },
    });
    expect(audit).not.toBeNull();

    const updated = await testDb.ownerUser.findUnique({ where: { id: fx.managerA.id } });
    expect(updated!.status).toBe("DISABLED");
  });
});

describe("owner-users tenant isolation", () => {
  it("does not list another tenant's users", async () => {
    const token = await loginAs(fx.ownerA.email);
    const res = await request(app)
      .get("/v1/owner/users")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.users.map((u: { email: string }) => u.email)).not.toContain(fx.ownerB.email);
  });

  it("returns 404 (not 403) when managing another tenant's user", async () => {
    const token = await loginAs(fx.ownerA.email);
    const res = await request(app)
      .post(`/v1/owner/users/${fx.ownerB.id}/disable`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
