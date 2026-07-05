import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generatePdfForSubmission } from "@gr/worker";
import {
  buildMultipartSubmission,
  buildTestApp,
  seedFixtures,
  testDb,
  truncateAll,
  type TestFixtures,
} from "./helpers.js";

const { app, deps } = buildTestApp();
let fx: TestFixtures;
let stayId: string;

async function postPrimarySubmission(): Promise<string> {
  const { payload, signatures } = buildMultipartSubmission();
  let req = request(app)
    .post(`/v1/public/registration-links/${fx.rawTokenA}/submissions`)
    .field("payload", payload);
  for (const [fieldname, buf] of Object.entries(signatures)) {
    req = req.attach(fieldname, buf, { filename: `${fieldname}.png`, contentType: "image/png" });
  }
  const res = await req;
  expect(res.status).toBe(201);
  return res.body.stayId as string;
}

async function loginAs(email: string): Promise<string> {
  const res = await request(app)
    .post("/v1/owner/auth/login")
    .send({ email, password: fx.password });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

beforeEach(async () => {
  await truncateAll();
  fx = await seedFixtures();
  stayId = await postPrimarySubmission();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("owner property routes", () => {
  it("lists only the caller's tenant properties", async () => {
    const token = await loginAs(fx.ownerA.email);
    const res = await request(app)
      .get("/v1/owner/properties")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.properties).toHaveLength(1);
    expect(res.body.properties[0].id).toBe(fx.propertyA.id);
  });

  it("lists own-tenant submissions with metadata only", async () => {
    const token = await loginAs(fx.ownerA.email);
    const res = await request(app)
      .get(`/v1/owner/properties/${fx.propertyA.id}/submissions`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.submissions).toHaveLength(1);
    const listed = res.body.submissions[0];
    expect(listed.id).toBe(stayId);
    // PR1: status stays OPEN until the worker (PR2) closes it.
    expect(listed.status).toBe("OPEN");
    expect(listed.cardCount).toBe(1);
    // The list endpoint exposes no guest names or contact details.
    expect(JSON.stringify(res.body)).not.toContain("Anna");
    expect(JSON.stringify(res.body)).not.toContain("guest@example.com");
  });

  it("returns 404 for another tenant's property", async () => {
    const token = await loginAs(fx.ownerB.email);
    const res = await request(app)
      .get(`/v1/owner/properties/${fx.propertyA.id}/submissions`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe("owner submission routes", () => {
  it("returns submission detail for the owning tenant and audits the view", async () => {
    const token = await loginAs(fx.ownerA.email);
    const res = await request(app)
      .get(`/v1/owner/submissions/${stayId}`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    // PR1: pdfAvailable is false — EncryptedPdf only exists for legacy submissions.
    expect(res.body.pdfAvailable).toBe(false);
    expect(Array.isArray(res.body.passengerCards)).toBe(true);
    expect(res.body.passengerCards).toHaveLength(1);
    const card = res.body.passengerCards[0];
    expect(card.guests).toHaveLength(1);
    // Document numbers never leave the encrypted PDF.
    expect(JSON.stringify(res.body)).not.toContain("X1234567");
    expect(card.guests[0].documentNumberEncrypted).toBeUndefined();

    const audit = await testDb.auditLog.findFirst({
      where: { action: "OWNER_VIEWED_SUBMISSION", resourceId: stayId },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(fx.ownerA.id);
  });

  it("hides another tenant's submission behind 404", async () => {
    const token = await loginAs(fx.ownerB.email);
    const res = await request(app)
      .get(`/v1/owner/submissions/${stayId}`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("blocks cross-tenant PDF download with 404", async () => {
    const token = await loginAs(fx.ownerB.email);
    const res = await request(app)
      .get(`/v1/owner/submissions/${stayId}/pdf`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe("PDF download RBAC", () => {
  it("denies VIEWER with 403 and no audit download entry", async () => {
    const token = await loginAs(fx.viewerA.email);
    const res = await request(app)
      .get(`/v1/owner/submissions/${stayId}/pdf`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "forbidden" });

    const downloads = await testDb.auditLog.count({
      where: { action: "OWNER_DOWNLOADED_PDF" },
    });
    expect(downloads).toBe(0);
  });

  it.each(["ownerA", "managerA"] as const)(
    "allows %s to download a decrypted PDF and audits it",
    async (userKey) => {
      // Seed a legacy EncryptedPdf by running the worker in-process.
      // The worker reads passengerCards.flatMap(c => c.guests) added by the PR1 submit.
      await generatePdfForSubmission(
        { tenantId: fx.tenantA.id, propertyId: fx.propertyA.id, submissionId: stayId },
        deps,
      );

      const user = fx[userKey];
      const token = await loginAs(user.email);
      const res = await request(app)
        .get(`/v1/owner/submissions/${stayId}/pdf`)
        .set("authorization", `Bearer ${token}`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => callback(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/pdf");
      const body = res.body as Buffer;
      expect(body.subarray(0, 5).toString("ascii")).toBe("%PDF-");

      const audit = await testDb.auditLog.findFirst({
        where: { action: "OWNER_DOWNLOADED_PDF", resourceId: stayId },
      });
      expect(audit).not.toBeNull();
      expect(audit!.actorId).toBe(user.id);
      expect(audit!.ipHash).toMatch(/^[0-9a-f]{64}$/);
    },
  );

  it("returns 409 when the PDF is not ready", async () => {
    // PR1: a fresh submission has status=OPEN and no EncryptedPdf → 409 naturally.
    const token = await loginAs(fx.ownerA.email);
    const res = await request(app)
      .get(`/v1/owner/submissions/${stayId}/pdf`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "pdf_not_ready" });
  });
});
