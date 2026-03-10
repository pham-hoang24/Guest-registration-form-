/**
 * Owner route integration tests.
 *
 * Tests:
 *   • GET /v1/owner/submissions/:id/pdf — valid download (200 + PDF bytes)
 *   • GET /v1/owner/submissions/:id/pdf — wrong tenant → 403
 *   • GET /v1/owner/submissions/:id/pdf — unknown submission → 403
 *   • GET /v1/owner/submissions/:id/pdf — PDF not ready → 404
 *   • GET /v1/owner/submissions/:id — metadata endpoint (200)
 *   • GET /v1/owner/properties/:propertyId/submissions — list endpoint (200)
 *   • No auth header → 401
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";

import { createApp } from "../src/app.js";
import { db, InMemoryDb } from "../src/services/db.js";
import { storage, InMemoryBlobStore } from "../src/services/storage.js";
import { MockKekAdapter } from "../src/crypto/keyVaultKek.js";
import { setKekAdapterForTests } from "../src/services/keyVault.js";
import { setKekAdapterForTests as setWorkerKek } from "../src/worker/processSubmission.js";
import { processSubmissionJob } from "../src/worker/processSubmission.js";

// ---------------------------------------------------------------------------
// Test server setup
// ---------------------------------------------------------------------------

const mockKek = new MockKekAdapter("https://kv/keys/kek", "v1");
let baseUrl: string;
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  if (!(db instanceof InMemoryDb)) throw new Error("Requires InMemoryDb — unset SQL_SERVER");
  if (!(storage instanceof InMemoryBlobStore)) throw new Error("Requires InMemoryBlobStore — unset BLOB_ACCOUNT_URL");
  setKekAdapterForTests(mockKek);
  setWorkerKek(mockKek);
  const app = createApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  setKekAdapterForTests(null);
  setWorkerKek(mockKek); // leave mock in place so we don't trigger real KV
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEV_SECRET = "dev-owner-secret"; // matches OWNER_JWT_SECRET default

function makeToken(opts: { userId: string; tenantId: string; propertyIds: string[] }): string {
  return jwt.sign(
    { tenantId: opts.tenantId, propertyIds: opts.propertyIds },
    DEV_SECRET,
    { algorithm: "HS256", subject: opts.userId, expiresIn: "1h" }
  );
}

async function setupReadySubmission(tenantId: string, propertyId: string) {
  const inDb = db as InMemoryDb;
  const submission = await inDb.createSubmission({
    id: crypto.randomUUID(),
    tenantId,
    propertyId,
    status: "PENDING_PDF",
    blobPath: null,
    aadVersion: 1,
    schemaVersion: 1,
    attemptCount: 0,
    lastError: null
  });
  await inDb.addMembership({ userId: "owner-1", propertyId, tenantId });
  await processSubmissionJob({ submissionId: submission.id, payload: { name: "Alice" } });
  return submission;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /v1/owner/submissions/:id/pdf", () => {
  beforeEach(() => {
    (db as InMemoryDb).reset();
    (storage as InMemoryBlobStore).reset();
  });

  it("returns 401 when no Authorization header", async () => {
    const res = await fetch(`${baseUrl}/v1/owner/submissions/any-id/pdf`);
    expect(res.status).toBe(401);
  });

  it("returns 403 when submission not found", async () => {
    const token = makeToken({ userId: "owner-1", tenantId: "tenant-1", propertyIds: ["prop-1"] });
    const res = await fetch(`${baseUrl}/v1/owner/submissions/not-found/pdf`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 when owner tenantId does not match submission tenantId", async () => {
    const inDb = db as InMemoryDb;
    const submission = await inDb.createSubmission({
      id: crypto.randomUUID(),
      tenantId: "tenant-OTHER",
      propertyId: "prop-1",
      status: "PENDING_PDF",
      blobPath: null,
      aadVersion: 1,
      schemaVersion: 1,
      attemptCount: 0,
      lastError: null
    });
    const token = makeToken({ userId: "owner-1", tenantId: "tenant-1", propertyIds: ["prop-1"] });
    const res = await fetch(`${baseUrl}/v1/owner/submissions/${submission.id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 when PDF not ready (PENDING_PDF)", async () => {
    const inDb = db as InMemoryDb;
    const submission = await inDb.createSubmission({
      id: crypto.randomUUID(),
      tenantId: "tenant-1",
      propertyId: "prop-1",
      status: "PENDING_PDF",
      blobPath: null,
      aadVersion: 1,
      schemaVersion: 1,
      attemptCount: 0,
      lastError: null
    });
    await inDb.addMembership({ userId: "owner-1", propertyId: "prop-1", tenantId: "tenant-1" });
    const token = makeToken({ userId: "owner-1", tenantId: "tenant-1", propertyIds: ["prop-1"] });
    const res = await fetch(`${baseUrl}/v1/owner/submissions/${submission.id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("not_ready");
  });

  it("returns 200 with PDF bytes for a READY submission", async () => {
    const submission = await setupReadySubmission("tenant-1", "prop-1");
    const token = makeToken({ userId: "owner-1", tenantId: "tenant-1", propertyIds: ["prop-1"] });
    const res = await fetch(`${baseUrl}/v1/owner/submissions/${submission.id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    const bytes = await res.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("returns 500 when ciphertext has been tampered (hash mismatch)", async () => {
    const submission = await setupReadySubmission("tenant-1", "prop-1");
    // Overwrite the blob with garbage so ciphertext hash no longer matches the stored sha256.
    const inDb = db as InMemoryDb;
    const record = await inDb.getEncryptedPdfRecord(submission.id);
    expect(record).not.toBeNull();
    await (storage as InMemoryBlobStore).put(
      record!.blobPath,
      Buffer.from("tampered-garbage-bytes"),
      "application/octet-stream"
    );
    const token = makeToken({ userId: "owner-1", tenantId: "tenant-1", propertyIds: ["prop-1"] });
    const res = await fetch(`${baseUrl}/v1/owner/submissions/${submission.id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("decrypt_failed");
  });
});

describe("GET /v1/owner/submissions/:id", () => {
  beforeEach(() => {
    (db as InMemoryDb).reset();
    (storage as InMemoryBlobStore).reset();
  });

  it("returns 401 without token", async () => {
    const res = await fetch(`${baseUrl}/v1/owner/submissions/any-id`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for unknown submission", async () => {
    const token = makeToken({ userId: "u1", tenantId: "t1", propertyIds: ["p1"] });
    const res = await fetch(`${baseUrl}/v1/owner/submissions/not-found`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(403);
  });

  it("returns submission metadata for accessible submission", async () => {
    const submission = await setupReadySubmission("tenant-1", "prop-1");
    const token = makeToken({ userId: "owner-1", tenantId: "tenant-1", propertyIds: ["prop-1"] });
    const res = await fetch(`${baseUrl}/v1/owner/submissions/${submission.id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; status: string };
    expect(body.id).toBe(submission.id);
    expect(body.status).toBe("READY");
  });
});

describe("GET /v1/owner/properties/:propertyId/submissions", () => {
  beforeEach(() => {
    (db as InMemoryDb).reset();
    (storage as InMemoryBlobStore).reset();
  });

  it("returns 401 without token", async () => {
    const res = await fetch(`${baseUrl}/v1/owner/properties/prop-1/submissions`);
    expect(res.status).toBe(401);
  });

  it("returns 403 when owner has no access to property", async () => {
    const token = makeToken({ userId: "owner-1", tenantId: "tenant-1", propertyIds: [] });
    const res = await fetch(`${baseUrl}/v1/owner/properties/prop-1/submissions`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(403);
  });

  it("returns paginated list of submissions", async () => {
    const inDb = db as InMemoryDb;
    await inDb.addMembership({ userId: "owner-1", propertyId: "prop-1", tenantId: "tenant-1" });
    await inDb.createSubmission({
      id: crypto.randomUUID(),
      tenantId: "tenant-1",
      propertyId: "prop-1",
      status: "READY",
      blobPath: "some/path",
      aadVersion: 1,
      schemaVersion: 1,
      attemptCount: 0,
      lastError: null
    });
    const token = makeToken({ userId: "owner-1", tenantId: "tenant-1", propertyIds: ["prop-1"] });
    const res = await fetch(`${baseUrl}/v1/owner/properties/prop-1/submissions`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { submissions: unknown[]; total: number };
    expect(body.submissions).toHaveLength(1);
    expect(body.total).toBe(1);
  });
});
