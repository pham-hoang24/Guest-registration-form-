import request from "supertest";
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  VALID_PNG,
  buildMultipartSubmission,
  buildTestApp,
  seedFixtures,
  testDb,
  truncateAll,
  type TestFixtures,
} from "./helpers.js";

const { app } = buildTestApp();
let fx: TestFixtures;

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

async function postSubmission(
  rawToken: string,
  payload: string,
  signatures: Record<string, Buffer>,
) {
  let req = request(app)
    .post(`/v1/public/registration-links/${rawToken}/submissions`)
    .field("payload", payload);
  for (const [fieldname, buf] of Object.entries(signatures)) {
    req = req.attach(fieldname, buf, { filename: `${fieldname}.png`, contentType: "image/png" });
  }
  return req;
}

beforeEach(async () => {
  await truncateAll();
  fx = await seedFixtures();
});

afterAll(async () => {
  await testDb.$disconnect();
});

// ── GET /v1/public/registration-links/:token ─────────────────────────────────

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

  it("returns 404 registration_link_unavailable for an unknown token", async () => {
    const res = await request(app).get("/v1/public/registration-links/not-a-real-token");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "registration_link_unavailable" });
  });

  it("returns the same 404 for a revoked link (no enumeration)", async () => {
    await testDb.registrationLink.update({
      where: { id: fx.linkA.id },
      data: { status: "REVOKED" },
    });
    const res = await request(app).get(`/v1/public/registration-links/${fx.rawTokenA}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "registration_link_unavailable" });
  });

  it("returns the same 404 for an expired link", async () => {
    await testDb.registrationLink.update({
      where: { id: fx.linkA.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await request(app).get(`/v1/public/registration-links/${fx.rawTokenA}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "registration_link_unavailable" });
  });

  it("returns the same 404 when stay is CLOSED", async () => {
    await testDb.guestSubmission.update({
      where: { id: fx.stayA.id },
      data: { status: "CLOSED" },
    });
    const res = await request(app).get(`/v1/public/registration-links/${fx.rawTokenA}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "registration_link_unavailable" });
  });
});

// ── POST /v1/public/registration-links/:token/submissions ────────────────────

describe("POST /v1/public/registration-links/:token/submissions", () => {
  it("201: creates passenger cards, guests, signatures, PdfJob placeholders — no EncryptedPdf", async () => {
    const { payload, signatures } = buildMultipartSubmission({ additionalAdultCount: 1 });
    const res = await postSubmission(fx.rawTokenA, payload, signatures);

    expect(res.status).toBe(201);
    expect(res.body.stayId).toBe(fx.stayA.id);
    expect(res.body.cardCount).toBe(2); // primary card + 1 additional adult card
    expect(Array.isArray(res.body.cardIds)).toBe(true);
    expect(res.body.cardIds).toHaveLength(2);

    // Stay is still OPEN after card submit.
    const stay = await testDb.guestSubmission.findUnique({ where: { id: fx.stayA.id } });
    expect(stay!.status).toBe("OPEN");
    // retainUntil/deleteAfter are set on first submit.
    expect(stay!.retainUntil).not.toBeNull();
    expect(stay!.deleteAfter).not.toBeNull();
    // Primary guest contact info copied to stay.
    expect(stay!.primaryGuestEmail).toBe("guest@example.com");

    // Cards under the stay.
    const cards = await testDb.passengerCard.findMany({
      where: { guestSubmissionId: fx.stayA.id },
      orderBy: { cardNumber: "asc" },
      include: {
        guests: true,
        signature: true,
        pdfJob: true,
      },
    });
    expect(cards).toHaveLength(2);
    expect(cards[0]!.cardType).toBe("PRIMARY_WITH_ALLOWED_FAMILY");
    expect(cards[1]!.cardType).toBe("ADDITIONAL_ADULT_INDIVIDUAL");

    for (const card of cards) {
      expect(card.status).toBe("SUBMITTED");
      // Each card has exactly one PdfJob in PENDING.
      expect(card.pdfJob).not.toBeNull();
      expect(card.pdfJob!.status).toBe("PENDING");
      // Each card has a signature.
      expect(card.signature).not.toBeNull();
      // Signature bytes are encrypted — never stored as raw base64.
      expect(card.signature!.signatureEncrypted).not.toBeNull();
      expect(card.signature!.signatureSha256).toMatch(/^[0-9a-f]{64}$/);
    }

    // No EncryptedPdf written by PR1 submit path.
    const pdf = await testDb.encryptedPdf.findFirst({ where: { submissionId: fx.stayA.id } });
    expect(pdf).toBeNull();

    // Guests are nested under cards, not under the submission directly.
    const primaryCard = cards[0]!;
    expect(primaryCard.guests).toHaveLength(1);
    const primaryGuest = primaryCard.guests[0]!;
    expect(primaryGuest.firstName).toBe("Anna");
    // Document number encrypted — not the raw string.
    expect(primaryGuest.documentNumberEncrypted).not.toBeNull();
    expect(primaryGuest.documentNumberEncrypted).not.toContain("X1234567");

    // Audit trail — only IDs + counts, no PII.
    const audits = await testDb.auditLog.findMany({
      where: { resourceType: "PassengerCard" },
    });
    expect(audits.length).toBeGreaterThan(0);
    for (const audit of audits) {
      const flat = JSON.stringify(audit);
      expect(flat).not.toContain("Anna");
      expect(flat).not.toContain("guest@example.com");
      expect(flat).not.toContain("X1234567");
    }
  });

  it("201: single primary guest (no additional adults)", async () => {
    const { payload, signatures } = buildMultipartSubmission();
    const res = await postSubmission(fx.rawTokenA, payload, signatures);
    expect(res.status).toBe(201);
    expect(res.body.cardCount).toBe(1);
  });

  it("200 + duplicate:true on identical re-submission", async () => {
    const { payload, signatures } = buildMultipartSubmission();
    const first = await postSubmission(fx.rawTokenA, payload, signatures);
    expect(first.status).toBe(201);

    const second = await postSubmission(fx.rawTokenA, payload, signatures);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(Array.isArray(second.body.cardIds)).toBe(true);

    // No extra cards created.
    const count = await testDb.passengerCard.count({ where: { guestSubmissionId: fx.stayA.id } });
    expect(count).toBe(1);
  });

  it("409 on partial-overlap re-submission", async () => {
    // Submit 1 card first.
    const { payload: p1, signatures: s1 } = buildMultipartSubmission();
    await postSubmission(fx.rawTokenA, p1, s1);

    // Submit 2 cards where one fingerprint already exists (primary is the same).
    const { payload: p2, signatures: s2 } = buildMultipartSubmission({ additionalAdultCount: 1 });
    const res = await postSubmission(fx.rawTokenA, p2, s2);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("duplicate_or_partial_resubmit");

    // Only the original 1 card should exist.
    const count = await testDb.passengerCard.count({ where: { guestSubmissionId: fx.stayA.id } });
    expect(count).toBe(1);
  });

  it("404 registration_link_unavailable for unknown token", async () => {
    const { payload, signatures } = buildMultipartSubmission();
    const res = await postSubmission("bogus-token", payload, signatures);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "registration_link_unavailable" });
    expect(await testDb.passengerCard.count()).toBe(0);
  });

  it("404 registration_link_unavailable for revoked link", async () => {
    await testDb.registrationLink.update({
      where: { id: fx.linkA.id },
      data: { status: "REVOKED" },
    });
    const { payload, signatures } = buildMultipartSubmission();
    const res = await postSubmission(fx.rawTokenA, payload, signatures);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "registration_link_unavailable" });
  });

  it("404 registration_link_unavailable when stay is CLOSED", async () => {
    await testDb.guestSubmission.update({
      where: { id: fx.stayA.id },
      data: { status: "CLOSED" },
    });
    const { payload, signatures } = buildMultipartSubmission();
    const res = await postSubmission(fx.rawTokenA, payload, signatures);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "registration_link_unavailable" });
  });

  it("400 when payload field is missing", async () => {
    const res = await request(app)
      .post(`/v1/public/registration-links/${fx.rawTokenA}/submissions`)
      .attach("signature_primary", VALID_PNG, { filename: "sig.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_failed");
  });

  it("400 on invalid JSON in payload field", async () => {
    const res = await request(app)
      .post(`/v1/public/registration-links/${fx.rawTokenA}/submissions`)
      .field("payload", "not-json")
      .attach("signature_primary", VALID_PNG, { filename: "sig.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_failed");
  });

  it("400 when departureDate <= arrivalDate", async () => {
    const { payload, signatures } = buildMultipartSubmission({
      arrivalDate: "2026-07-20",
      departureDate: "2026-07-19",
    });
    const res = await postSubmission(fx.rawTokenA, payload, signatures);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_failed");
    expect(await testDb.passengerCard.count()).toBe(0);
  });

  it("400 when stay fields don't match the pre-created stay", async () => {
    const { payload, signatures } = buildMultipartSubmission({
      arrivalDate: "2026-08-01", // wrong — stay has 2026-07-20
      departureDate: "2026-08-05", // keep valid ordering so Zod doesn't trip first
    });
    const res = await postSubmission(fx.rawTokenA, payload, signatures);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("stay_field_mismatch");
    expect(await testDb.passengerCard.count()).toBe(0);
  });

  it("400 when a signature file is missing", async () => {
    const { payload } = buildMultipartSubmission();
    // Send payload but no signature file.
    const res = await request(app)
      .post(`/v1/public/registration-links/${fx.rawTokenA}/submissions`)
      .field("payload", payload);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_signature");
    expect(await testDb.passengerCard.count()).toBe(0);
  });

  it("400 when an extra unexpected signature field is uploaded", async () => {
    const { payload, signatures } = buildMultipartSubmission();
    signatures["signature_additionalAdult_0"] = VALID_PNG; // unexpected
    const res = await postSubmission(fx.rawTokenA, payload, signatures);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_signature_field");
    expect(await testDb.passengerCard.count()).toBe(0);
  });

  it("400 when signature file is not a valid PNG (wrong magic bytes)", async () => {
    const notAPng = Buffer.from("not a png at all");
    const { payload } = buildMultipartSubmission();
    const res = await request(app)
      .post(`/v1/public/registration-links/${fx.rawTokenA}/submissions`)
      .field("payload", payload)
      .attach("signature_primary", notAPng, {
        filename: "sig.png",
        contentType: "image/png",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_signature_format");
    expect(await testDb.passengerCard.count()).toBe(0);
  });

  it("does not include raw signature bytes in audit logs", async () => {
    const { payload, signatures } = buildMultipartSubmission();
    await postSubmission(fx.rawTokenA, payload, signatures);

    const allAudits = await testDb.auditLog.findMany({});
    const flat = JSON.stringify(allAudits);
    // Signature is a base64-encoded PNG — its first bytes in base64 are "iVBORw".
    // Assert no base64 PNG content leaked into any audit record.
    expect(flat).not.toContain("iVBORw");
    expect(flat).not.toContain(VALID_PNG.toString("base64").slice(0, 20));
  });

  it("signature stored encrypted, not as raw base64", async () => {
    const { payload, signatures } = buildMultipartSubmission();
    await postSubmission(fx.rawTokenA, payload, signatures);

    const sig = await testDb.passengerCardSignature.findFirst({});
    expect(sig).not.toBeNull();
    // The encrypted blob is a JSON string starting with {"v":2,...}, not raw base64 PNG.
    expect(sig!.signatureEncrypted).toMatch(/^\{.*"v":2/);
    expect(sig!.signatureEncrypted).not.toContain(VALID_PNG.toString("base64").slice(0, 20));
  });

  it("guest document numbers stored encrypted, not in plaintext", async () => {
    const { payload, signatures } = buildMultipartSubmission();
    await postSubmission(fx.rawTokenA, payload, signatures);

    const guests = await testDb.guest.findMany({});
    for (const guest of guests) {
      if (guest.documentNumberEncrypted) {
        expect(guest.documentNumberEncrypted).not.toContain("X1234567");
        // Encrypted JSON blob starts with {"v":2,...}
        expect(guest.documentNumberEncrypted).toMatch(/^\{.*"v":2/);
      }
    }
  });
});
