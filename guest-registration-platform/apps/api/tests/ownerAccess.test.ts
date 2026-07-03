import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildTestApp,
  seedFixtures,
  testDb,
  truncateAll,
  validSubmissionBody,
  type TestFixtures,
} from "./helpers.js";

const { app } = buildTestApp();
let fx: TestFixtures;
let submissionIdA: string;

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
  const res = await request(app)
    .post(`/v1/public/registration-links/${fx.rawTokenA}/submissions`)
    .send(validSubmissionBody);
  expect(res.status).toBe(201);
  submissionIdA = res.body.submissionId as string;
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
    expect(listed.id).toBe(submissionIdA);
    expect(listed.status).toBe("PDF_READY");
    expect(listed.guestCount).toBe(1);
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
      .get(`/v1/owner/submissions/${submissionIdA}`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.pdfAvailable).toBe(true);
    expect(res.body.guests).toHaveLength(1);
    // Document numbers never leave the encrypted PDF.
    expect(JSON.stringify(res.body)).not.toContain("X1234567");
    expect(res.body.guests[0].documentNumberEncrypted).toBeUndefined();

    const audit = await testDb.auditLog.findFirst({
      where: { action: "OWNER_VIEWED_SUBMISSION", resourceId: submissionIdA },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(fx.ownerA.id);
  });

  it("hides another tenant's submission behind 404", async () => {
    const token = await loginAs(fx.ownerB.email);
    const res = await request(app)
      .get(`/v1/owner/submissions/${submissionIdA}`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("blocks cross-tenant PDF download with 404", async () => {
    const token = await loginAs(fx.ownerB.email);
    const res = await request(app)
      .get(`/v1/owner/submissions/${submissionIdA}/pdf`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe("PDF download RBAC", () => {
  it("denies VIEWER with 403 and no audit download entry", async () => {
    const token = await loginAs(fx.viewerA.email);
    const res = await request(app)
      .get(`/v1/owner/submissions/${submissionIdA}/pdf`)
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
      const user = fx[userKey];
      const token = await loginAs(user.email);
      const res = await request(app)
        .get(`/v1/owner/submissions/${submissionIdA}/pdf`)
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
        where: { action: "OWNER_DOWNLOADED_PDF", resourceId: submissionIdA },
      });
      expect(audit).not.toBeNull();
      expect(audit!.actorId).toBe(user.id);
      expect(audit!.ipHash).toMatch(/^[0-9a-f]{64}$/);
    },
  );

  it("returns 409 when the PDF is not ready", async () => {
    await testDb.encryptedPdf.deleteMany({ where: { submissionId: submissionIdA } });
    await testDb.guestSubmission.update({
      where: { id: submissionIdA },
      data: { status: "RECEIVED" },
    });
    const token = await loginAs(fx.ownerA.email);
    const res = await request(app)
      .get(`/v1/owner/submissions/${submissionIdA}/pdf`)
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "pdf_not_ready" });
  });
});
