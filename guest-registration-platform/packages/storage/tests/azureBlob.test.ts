import { describe, expect, it } from "vitest";
import { AzureBlobStorageProvider, type BlobContainer } from "../src/azureBlob.js";

function fakeContainer() {
  const blobs = new Map<string, { body: Buffer; contentType: string }>();
  const container: BlobContainer = {
    async uploadBlob({ path, body, contentType }) {
      blobs.set(path, { body: Buffer.from(body), contentType });
    },
    async downloadBlob({ path }) {
      const blob = blobs.get(path);
      if (!blob) throw new Error(`BlobNotFound: ${path}`);
      return blob.body;
    },
    async deleteBlob({ path }) {
      blobs.delete(path);
    },
  };
  return { container, blobs };
}

describe("AzureBlobStorageProvider", () => {
  it("round-trips put/get/delete and preserves the content type", async () => {
    const { container, blobs } = fakeContainer();
    const provider = new AzureBlobStorageProvider(container);
    const path = "tenant/t1/property/p1/submission/s1.pdf.enc";
    const body = Buffer.from("ciphertext-bytes");

    const put = await provider.putObject({ path, contentType: "application/octet-stream", body });
    expect(put.path).toBe(path);
    expect(blobs.get(path)?.contentType).toBe("application/octet-stream");

    const fetched = await provider.getObject({ path });
    expect(fetched.equals(body)).toBe(true);

    await provider.deleteObject({ path });
    expect(blobs.has(path)).toBe(false);
  });

  it("rejects unsafe object paths", async () => {
    const { container } = fakeContainer();
    const provider = new AzureBlobStorageProvider(container);
    const body = Buffer.from("x");

    for (const path of ["/absolute.enc", "a/../b.enc", "a//b.enc", "a\\b.enc", "", "./a.enc"]) {
      await expect(
        provider.putObject({ path, contentType: "application/octet-stream", body }),
      ).rejects.toThrow(/Invalid object path/);
    }
  });

  it("fromEnv requires connection string and container name", () => {
    expect(() => AzureBlobStorageProvider.fromEnv({} as NodeJS.ProcessEnv)).toThrow(
      /AZURE_STORAGE_CONNECTION_STRING/,
    );
  });
});
