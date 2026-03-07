import { beforeEach, describe, expect, it } from "vitest";
import { db, InMemoryDb } from "../src/services/db.js";
import { storage } from "../src/services/storage.js";
import { encryptPayload } from "../src/services/payloadEncryption.js";
import { processSubmissionJob, setKekAdapterForTests } from "../src/worker/processSubmission.js";
import { MockKekAdapter } from "../src/crypto/keyVaultKek.js";

describe("worker idempotency", () => {
  beforeEach(() => {
    (db as InMemoryDb).reset();
    storage.reset();
    setKekAdapterForTests(new MockKekAdapter("https://kv/keys/kek", "v1"));
  });

  it("does not re-encrypt on duplicate job", async () => {
    const submission = await db.createSubmission({
      id: "sub-1",
      tenantId: "tenant-1",
      propertyId: "prop-1",
      status: "PENDING_PDF",
      blobPath: null,
      aadVersion: 1,
      schemaVersion: 1,
      attemptCount: 0,
      lastError: null
    });

    await processSubmissionJob({ submissionId: submission.id, payload: { name: "Alice" } });
    const recordAfterFirst = await db.getEncryptedPdfRecord(submission.id);
    const blobAfterFirst = recordAfterFirst ? await storage.get(recordAfterFirst.blobPath) : null;
    expect(recordAfterFirst).not.toBeNull();
    expect(blobAfterFirst).not.toBeNull();

    await processSubmissionJob({ submissionId: submission.id, payload: { name: "Alice" } });
    const recordAfterSecond = await db.getEncryptedPdfRecord(submission.id);
    const blobAfterSecond = recordAfterSecond ? await storage.get(recordAfterSecond.blobPath) : null;

    expect(recordAfterSecond?.createdAt).toBe(recordAfterFirst?.createdAt);
    expect(recordAfterSecond?.ciphertextSha256Hex).toBe(recordAfterFirst?.ciphertextSha256Hex);
    expect(blobAfterSecond?.ciphertext.toString("hex")).toBe(blobAfterFirst?.ciphertext.toString("hex"));
  });
});

describe("worker DB-backed payload", () => {
  const mockKek = new MockKekAdapter("https://kv/keys/kek", "v1");

  beforeEach(() => {
    (db as InMemoryDb).reset();
    storage.reset();
    setKekAdapterForTests(mockKek);
  });

  it("loads and decrypts payload from store when job has no payload", async () => {
    const submission = await db.createSubmission({
      id: "sub-db-1",
      tenantId: "tenant-1",
      propertyId: "prop-1",
      status: "PENDING_PDF",
      blobPath: null,
      aadVersion: 1,
      schemaVersion: 1,
      attemptCount: 0,
      lastError: null
    });

    const encrypted = await encryptPayload(
      JSON.stringify({ name: "Bob" }),
      {
        tenantId: submission.tenantId,
        propertyId: submission.propertyId,
        submissionId: submission.id
      },
      mockKek
    );
    await db.insertPayload(submission.tenantId, submission.propertyId, submission.id, encrypted);

    await processSubmissionJob({ submissionId: submission.id });

    const updated = await db.getSubmission(submission.id);
    expect(updated?.status).toBe("READY");
    const record = await db.getEncryptedPdfRecord(submission.id);
    expect(record).not.toBeNull();
    expect(record?.status).toBe("READY");
  });
});
