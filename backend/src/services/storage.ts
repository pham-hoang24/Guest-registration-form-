import { AzureBlobStorage } from "./azureBlobStorage.js";
import type { BlobStore } from "./blobStoreInterface.js";

export type { BlobStore } from "./blobStoreInterface.js";

type StoredBlob = {
  ciphertext: Buffer;
  contentType: string;
};

export class InMemoryBlobStore implements BlobStore {
  private blobs = new Map<string, StoredBlob>();

  async put(path: string, data: Buffer, contentType: string): Promise<void> {
    this.blobs.set(path, { ciphertext: data, contentType });
  }

  async get(path: string, maxBytes?: number): Promise<{ ciphertext: Buffer } | null> {
    const blob = this.blobs.get(path) ?? null;
    if (blob && maxBytes !== undefined && blob.ciphertext.byteLength > maxBytes) {
      throw new Error("blob_exceeds_max_size");
    }
    return blob;
  }

  async delete(path: string): Promise<void> {
    this.blobs.delete(path);
  }

  reset(): void {
    this.blobs.clear();
  }
}

/**
 * Active blob store adapter.
 * - BLOB_ACCOUNT_URL set  → AzureBlobStorage (Managed Identity)
 * - BLOB_ACCOUNT_URL unset → InMemoryBlobStore (local dev / tests)
 */
export const storage: BlobStore = process.env.BLOB_ACCOUNT_URL
  ? new AzureBlobStorage()
  : new InMemoryBlobStore();
