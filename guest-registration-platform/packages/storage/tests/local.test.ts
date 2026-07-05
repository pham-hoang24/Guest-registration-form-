import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptedPdfBlobPath, LocalStorageProvider } from "../src/index.js";

let dir: string;
let storage: LocalStorageProvider;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "gr-storage-"));
  storage = new LocalStorageProvider(dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("LocalStorageProvider", () => {
  it("puts, gets and deletes objects", async () => {
    const body = Buffer.from("encrypted-bytes");
    const objectPath = encryptedPdfBlobPath({
      tenantId: "t1",
      propertyId: "p1",
      batchId: "s1",
      passengerCardId: "c1",
    });
    await storage.putObject({ path: objectPath, contentType: "application/octet-stream", body });
    const roundTrip = await storage.getObject({ path: objectPath });
    expect(roundTrip.equals(body)).toBe(true);

    await storage.deleteObject({ path: objectPath });
    await expect(storage.getObject({ path: objectPath })).rejects.toThrow();
  });

  it("rejects path traversal and absolute paths", async () => {
    const body = Buffer.from("x");
    await expect(
      storage.putObject({ path: "../escape.bin", contentType: "application/octet-stream", body }),
    ).rejects.toThrow(/escapes storage root/);
    await expect(
      storage.putObject({ path: "/etc/passwd", contentType: "application/octet-stream", body }),
    ).rejects.toThrow(/must be relative/);
  });
});
