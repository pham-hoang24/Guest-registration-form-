import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildMultipartSubmission,
  buildTestApp,
  buildTestAppWithEnv,
  extractSessionCookie,
  seedFixtures,
  testDb,
  truncateAll,
  type TestFixtures,
} from "./helpers.js";

const { app } = buildTestApp();
let fx: TestFixtures;

const ACTIVE_LINK_PATH = (propertyId: string) =>
  `/v1/owner/properties/${propertyId}/active-registration-link`;

const validBody = () => ({
  arrivalDate: "2026-09-01",
  departureDate: "2026-09-04",
  maxPassengerCards: 10,
  linkTtlHours: 48 as const,
});

/** Logs in and returns the session cookie plus its bound CSRF token. */
async function loginCookie(email: string): Promise<{ cookie: string; csrfToken: string }> {
  const res = await request(app).post("/v1/owner/auth/login").send({ email, password: fx.password });
  expect(res.status).toBe(200);
  return { cookie: extractSessionCookie(res), csrfToken: res.body.csrfToken as string };
}

/** Logs in and returns a Bearer token (the raw session JWT), which skips CSRF. */
async function loginBearer(email: string): Promise<string> {
  const res = await request(app).post("/v1/owner/auth/login").send({ email, password: fx.password });
  expect(res.status).toBe(200);
  return extractSessionCookie(res);
}

/** Posts an active-link request as a Bearer-authenticated user (no CSRF needed). */
function postAsBearer(propertyId: string, token: string, body: object = validBody()) {
  return request(app)
    .post(ACTIVE_LINK_PATH(propertyId))
    .set("authorization", `Bearer ${token}`)
    .send(body);
}

/** Extracts the raw registration token embedded in a returned capability URL. */
function tokenFromUrl(url: string): string {
  return new URL(url).pathname.split("/").pop()!;
}

/** Submits one primary passenger card against the seed link, marking the stay as submitted. */
async function submitOneCard(): Promise<void> {
  const { payload, signatures } = buildMultipartSubmission();
  let req = request(app)
    .post(`/v1/public/registration-links/${fx.rawTokenA}/submissions`)
    .field("payload", payload);
  for (const [fieldname, buf] of Object.entries(signatures)) {
    req = req.attach(fieldname, buf, { filename: `${fieldname}.png`, contentType: "image/png" });
  }
  const res = await req;
  expect(res.status).toBe(201);
}

beforeEach(async () => {
  await truncateAll();
  fx = await seedFixtures();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("POST active-registration-link — success", () => {
  it("OWNER (cookie + CSRF) creates a link; response is no-store and carries only url/dates/ttl", async () => {
    const { cookie, csrfToken } = await loginCookie(fx.ownerA.email);
    const res = await request(app)
      .post(ACTIVE_LINK_PATH(fx.propertyA.id))
      .set("cookie", `gr_owner_session=${cookie}`)
      .set("x-csrf-token", csrfToken)
      .send(validBody());

    expect(res.status).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["pragma"]).toBe("no-cache");
    expect(Object.keys(res.body).sort()).toEqual(
      ["createdAt", "expiresAt", "linkTtlHours", "url"].sort(),
    );
    expect(res.body.url).toContain("/registration/");
    expect(res.body.linkTtlHours).toBe(48);

    // expiresAt = createdAt + 48h.
    const delta = new Date(res.body.expiresAt).getTime() - new Date(res.body.createdAt).getTime();
    expect(delta).toBe(48 * 60 * 60 * 1000);
  });

  it("MANAGER (bearer) creates a link too", async () => {
    const token = await loginBearer(fx.managerA.email);
    const res = await postAsBearer(fx.propertyA.id, token);
    expect(res.status).toBe(201);
  });

  it("persists only the token hash — never the raw token — and a new ACTIVE link + OPEN stay", async () => {
    const token = await loginBearer(fx.ownerA.email);
    const res = await postAsBearer(fx.propertyA.id, token);
    expect(res.status).toBe(201);
    const rawToken = tokenFromUrl(res.body.url);

    // Exactly one ACTIVE link remains for the property, and it stores the hash.
    const active = await testDb.registrationLink.findMany({
      where: { propertyId: fx.propertyA.id, status: "ACTIVE" },
    });
    expect(active).toHaveLength(1);
    expect(active[0]!.tokenHash).not.toBe(rawToken);
    expect(active[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // The raw token is nowhere in the RegistrationLink row.
    expect(JSON.stringify(active[0]!)).not.toContain(rawToken);

    const stay = await testDb.guestSubmission.findFirstOrThrow({
      where: { registrationLinkId: active[0]!.id },
    });
    expect(stay.status).toBe("OPEN");
    expect(stay.maxPassengerCards).toBe(10);
    // The owner never sets purpose — the first guest card does (Tier 3B).
    expect(stay.purposeOfStay).toBeNull();
  });

  it("writes REGISTRATION_LINK_REGENERATED with counts/ids only — no token/url/hash", async () => {
    const token = await loginBearer(fx.ownerA.email);
    const res = await postAsBearer(fx.propertyA.id, token);
    expect(res.status).toBe(201);
    const rawToken = tokenFromUrl(res.body.url);

    const audit = await testDb.auditLog.findFirstOrThrow({
      where: { action: "REGISTRATION_LINK_REGENERATED", actorId: fx.ownerA.id },
    });
    const meta = JSON.parse(audit.metadataJson!);
    expect(meta).toMatchObject({
      propertyId: fx.propertyA.id,
      previousActiveRevokedCount: 1,
      previousEmptyExpiredCount: 1,
      previousSubmittedClosedCount: 0,
      linkTtlHours: 48,
    });
    // No secret capability material in the audit row.
    expect(audit.metadataJson).not.toContain(rawToken);
    expect(audit.metadataJson).not.toContain(res.body.url);
    expect(audit.metadataJson).not.toContain(new URL(res.body.url).host);
  });
});

describe("POST active-registration-link — lifecycle transitions", () => {
  it("revokes the prior ACTIVE link and EXPIRES an empty prior stay", async () => {
    const priorLinkId = fx.linkA.id;
    const priorStayId = fx.stayA.id;

    const token = await loginBearer(fx.ownerA.email);
    const res = await postAsBearer(fx.propertyA.id, token);
    expect(res.status).toBe(201);

    const priorLink = await testDb.registrationLink.findUniqueOrThrow({ where: { id: priorLinkId } });
    expect(priorLink.status).toBe("REVOKED");
    const priorStay = await testDb.guestSubmission.findUniqueOrThrow({ where: { id: priorStayId } });
    expect(priorStay.status).toBe("EXPIRED");
  });

  it("CLOSES a prior stay that already has submitted cards", async () => {
    await submitOneCard();
    const priorStayId = fx.stayA.id;

    const token = await loginBearer(fx.ownerA.email);
    const res = await postAsBearer(fx.propertyA.id, token);
    expect(res.status).toBe(201);

    const priorStay = await testDb.guestSubmission.findUniqueOrThrow({ where: { id: priorStayId } });
    expect(priorStay.status).toBe("CLOSED");

    const audit = await testDb.auditLog.findFirstOrThrow({
      where: { action: "REGISTRATION_LINK_REGENERATED", actorId: fx.ownerA.id },
    });
    const meta = JSON.parse(audit.metadataJson!);
    expect(meta.previousSubmittedClosedCount).toBe(1);
    expect(meta.previousEmptyExpiredCount).toBe(0);
  });
});

describe("POST active-registration-link — authz & CSRF", () => {
  it("VIEWER gets 403, writes UNAUTHORIZED_ACCESS_ATTEMPT, and creates no link", async () => {
    const token = await loginBearer(fx.viewerA.email);
    const res = await postAsBearer(fx.propertyA.id, token);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "forbidden" });

    const denied = await testDb.auditLog.findFirst({
      where: { action: "UNAUTHORIZED_ACCESS_ATTEMPT", actorId: fx.viewerA.id },
    });
    expect(denied).not.toBeNull();

    // No new link: only the single seed ACTIVE link exists, still ACTIVE.
    const links = await testDb.registrationLink.findMany({ where: { propertyId: fx.propertyA.id } });
    expect(links).toHaveLength(1);
    expect(links[0]!.status).toBe("ACTIVE");
    // No regenerate audit row.
    expect(
      await testDb.auditLog.count({ where: { action: "REGISTRATION_LINK_REGENERATED" } }),
    ).toBe(0);
  });

  it("rejects a cookie mutation with no CSRF token (403) and creates no link", async () => {
    const { cookie } = await loginCookie(fx.ownerA.email);
    const res = await request(app)
      .post(ACTIVE_LINK_PATH(fx.propertyA.id))
      .set("cookie", `gr_owner_session=${cookie}`)
      .send(validBody());
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "csrf_failed" });
    expect(
      await testDb.auditLog.count({ where: { action: "REGISTRATION_LINK_REGENERATED" } }),
    ).toBe(0);
  });

  it("returns 404 for a foreign-tenant property and creates no link", async () => {
    const token = await loginBearer(fx.ownerB.email);
    const res = await postAsBearer(fx.propertyA.id, token);
    expect(res.status).toBe(404);
    // propertyA's seed link is untouched.
    const active = await testDb.registrationLink.findMany({
      where: { propertyId: fx.propertyA.id, status: "ACTIVE" },
    });
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(fx.linkA.id);
  });

  it("rejects an invalid body (departure before arrival) with 400", async () => {
    const token = await loginBearer(fx.ownerA.email);
    const res = await postAsBearer(fx.propertyA.id, token, {
      arrivalDate: "2026-09-04",
      departureDate: "2026-09-01",
    });
    expect(res.status).toBe(400);
  });
});

describe("active link uniqueness & concurrency", () => {
  it("partial unique index blocks a second ACTIVE link for one property", async () => {
    // Direct DB insert of a second ACTIVE link must violate the partial unique index.
    await expect(
      testDb.registrationLink.create({
        data: {
          tenantId: fx.tenantA.id,
          propertyId: fx.propertyA.id,
          tokenHash: "f".repeat(64),
          status: "ACTIVE",
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("concurrent creates converge to one ACTIVE link, one audit row, conflicts are 409 without a url", async () => {
    const token = await loginBearer(fx.ownerA.email);
    const [a, b] = await Promise.all([
      postAsBearer(fx.propertyA.id, token),
      postAsBearer(fx.propertyA.id, token),
    ]);

    const statuses = [a.status, b.status].sort();
    const successes = [a, b].filter((r) => r.status === 201);
    const conflicts = [a, b].filter((r) => r.status === 409);

    // Whatever the interleaving, no request may both fail-with-conflict and hand back a URL.
    for (const c of conflicts) {
      expect(c.body).toEqual({ error: "active_link_conflict" });
      expect(c.body.url).toBeUndefined();
    }

    // At most one ACTIVE link survives.
    const active = await testDb.registrationLink.findMany({
      where: { propertyId: fx.propertyA.id, status: "ACTIVE" },
    });
    expect(active).toHaveLength(1);

    // Exactly one audit row per successful create — conflicts write none.
    const auditCount = await testDb.auditLog.count({
      where: { action: "REGISTRATION_LINK_REGENERATED" },
    });
    expect(auditCount).toBe(successes.length);
    // Sanity: statuses are only 201/409.
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
  });
});

describe("public link usability after regeneration", () => {
  it("the new token is usable; the replaced token is not", async () => {
    const token = await loginBearer(fx.ownerA.email);
    const res = await postAsBearer(fx.propertyA.id, token);
    expect(res.status).toBe(201);
    const newToken = tokenFromUrl(res.body.url);

    // New ACTIVE + future-expiry + OPEN stay → usable.
    const usable = await request(app).get(`/v1/public/registration-links/${newToken}`);
    expect(usable.status).toBe(200);

    // Old link is now REVOKED → generic unavailable (never reveals which condition failed).
    const old = await request(app).get(`/v1/public/registration-links/${fx.rawTokenA}`);
    expect(old.status).toBe(404);
    expect(old.body).toEqual({ error: "registration_link_unavailable" });
  });

  it("an ACTIVE link past its expiry is unavailable", async () => {
    const token = await loginBearer(fx.ownerA.email);
    const res = await postAsBearer(fx.propertyA.id, token);
    const newToken = tokenFromUrl(res.body.url);

    await testDb.registrationLink.updateMany({
      where: { propertyId: fx.propertyA.id, status: "ACTIVE" },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const expired = await request(app).get(`/v1/public/registration-links/${newToken}`);
    expect(expired.status).toBe(404);
    expect(expired.body).toEqual({ error: "registration_link_unavailable" });
  });

  it("an ACTIVE link whose stay is no longer OPEN is unavailable", async () => {
    // Seed link is ACTIVE + future; force its stay CLOSED and it must stop resolving.
    await testDb.guestSubmission.update({
      where: { id: fx.stayA.id },
      data: { status: "CLOSED" },
    });
    const closed = await request(app).get(`/v1/public/registration-links/${fx.rawTokenA}`);
    expect(closed.status).toBe(404);
    expect(closed.body).toEqual({ error: "registration_link_unavailable" });
  });
});

describe("active-link rate limit (5 / property / hour)", () => {
  // rateLimitEnabled is false under NODE_ENV=test; force it on so the limiter runs.
  const rl = buildTestAppWithEnv({ NODE_ENV: "development" });

  async function loginBearerOn(appInstance: typeof rl.app, email: string): Promise<string> {
    const res = await request(appInstance)
      .post("/v1/owner/auth/login")
      .send({ email, password: fx.password });
    expect(res.status).toBe(200);
    return extractSessionCookie(res);
  }

  it("VIEWER 403s do not consume quota; OWNER+MANAGER share 5, the 6th is 429", async () => {
    const viewerTok = await loginBearerOn(rl.app, fx.viewerA.email);
    // Three denied VIEWER attempts must not count against the property quota.
    for (let i = 0; i < 3; i++) {
      const denied = await request(rl.app)
        .post(ACTIVE_LINK_PATH(fx.propertyA.id))
        .set("authorization", `Bearer ${viewerTok}`)
        .send(validBody());
      expect(denied.status).toBe(403);
    }

    const ownerTok = await loginBearerOn(rl.app, fx.ownerA.email);
    const managerTok = await loginBearerOn(rl.app, fx.managerA.email);
    const actorTokens = [ownerTok, managerTok, ownerTok, managerTok, ownerTok];
    for (const t of actorTokens) {
      const ok = await request(rl.app)
        .post(ACTIVE_LINK_PATH(fx.propertyA.id))
        .set("authorization", `Bearer ${t}`)
        .send(validBody());
      expect(ok.status).toBe(201);
    }

    const sixth = await request(rl.app)
      .post(ACTIVE_LINK_PATH(fx.propertyA.id))
      .set("authorization", `Bearer ${ownerTok}`)
      .send(validBody());
    expect(sixth.status).toBe(429);
    expect(sixth.body).toEqual({ error: "too_many_requests" });
  });
});
