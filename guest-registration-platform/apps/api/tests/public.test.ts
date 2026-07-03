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

beforeEach(async () => {
  await truncateAll();
  fx = await seedFixtures();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe("GET /v1/public/registration-links/:token", () => {
  it("returns safe public info for a valid token", async () => {
    const res = await request(app).get(`/v1/public/registration-links/${fx.rawTokenA}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      propertyName: "Cabin A",
      propertyCity: "Tampere",
      requirementVersion: "FI-ACCOMMODATION-2026-01",
      supportedLanguages: ["en", "fi", "sv"],
    });
    // No IDs or address leak through the public endpoint.
    expect(JSON.stringify(res.body)).not.toContain(fx.tenantA.id);
    expect(JSON.stringify(res.body)).not.toContain(fx.propertyA.id);
  });

  it("rejects an unknown token", async () => {
    const res = await request(app).get("/v1/public/registration-links/not-a-real-token");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "invalid_or_expired_link" });
  });

  it("rejects an expired link", async () => {
    await testDb.registrationLink.update({
      where: { id: fx.linkA.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await request(app).get(`/v1/public/registration-links/${fx.rawTokenA}`);
    expect(res.status).toBe(404);
  });

  it("rejects a disabled link", async () => {
    await testDb.registrationLink.update({
      where: { id: fx.linkA.id },
      data: { status: "DISABLED" },
    });
    const res = await request(app).get(`/v1/public/registration-links/${fx.rawTokenA}`);
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/public/registration-links/:token/submissions", () => {
  it("creates a submission, guests, encrypted PDF and audit trail", async () => {
    const res = await request(app)
      .post(`/v1/public/registration-links/${fx.rawTokenA}/submissions`)
      .send(validSubmissionBody);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("RECEIVED");
    const submissionId = res.body.submissionId as string;

    const submission = await testDb.guestSubmission.findFirst({
      where: { id: submissionId, tenantId: fx.tenantA.id },
      include: { guests: true, encryptedPdf: true },
    });
    expect(submission).not.toBeNull();
    expect(submission!.status).toBe("PDF_READY");
    expect(submission!.requirementVersion).toBe("FI-ACCOMMODATION-2026-01");
    expect(submission!.retainUntil.getTime()).toBeGreaterThan(Date.now());
    expect(submission!.deleteAfter.getTime()).toBeGreaterThan(
      submission!.retainUntil.getTime(),
    );

    // Document number is stored encrypted, never in plaintext.
    expect(submission!.guests).toHaveLength(1);
    expect(submission!.guests[0]!.documentNumberEncrypted).not.toContain("X1234567");

    // Envelope-encryption metadata persisted with the PDF record.
    const pdf = submission!.encryptedPdf!;
    expect(pdf.algorithm).toBe("AES-256-GCM");
    expect(pdf.kekKeyId).toMatch(/^local-kms:/);
    expect(pdf.sha256Ciphertext).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(pdf.aadJson)).toEqual({
      propertyId: fx.propertyA.id,
      requirementVersion: "FI-ACCOMMODATION-2026-01",
      submissionId,
      tenantId: fx.tenantA.id,
    });

    const audits = await testDb.auditLog.findMany({ where: { resourceId: submissionId } });
    const actions = audits.map((a) => a.action).sort();
    expect(actions).toEqual(["GUEST_REGISTRATION_SUBMITTED", "PDF_GENERATED"]);
    // Audit rows carry no raw PII.
    for (const audit of audits) {
      const flat = JSON.stringify(audit);
      expect(flat).not.toContain("Anna");
      expect(flat).not.toContain("guest@example.com");
      expect(flat).not.toContain("X1234567");
    }
  });

  it("rejects submissions against an invalid token", async () => {
    const res = await request(app)
      .post("/v1/public/registration-links/bogus/submissions")
      .send(validSubmissionBody);
    expect(res.status).toBe(404);
    expect(await testDb.guestSubmission.count()).toBe(0);
  });

  it("rejects invalid payloads with 400 and creates nothing", async () => {
    const res = await request(app)
      .post(`/v1/public/registration-links/${fx.rawTokenA}/submissions`)
      .send({ ...validSubmissionBody, departureDate: "2026-07-19" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_failed");
    expect(await testDb.guestSubmission.count()).toBe(0);
  });
});
