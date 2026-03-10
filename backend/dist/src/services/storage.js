import { AzureBlobStorage } from "./azureBlobStorage.js";
export class InMemoryBlobStore {
    blobs = new Map();
    async put(path, data, contentType) {
        this.blobs.set(path, { ciphertext: data, contentType });
    }
    async get(path, maxBytes) {
        const blob = this.blobs.get(path) ?? null;
        if (blob && maxBytes !== undefined && blob.ciphertext.byteLength > maxBytes) {
            throw new Error("blob_exceeds_max_size");
        }
        return blob;
    }
    async delete(path) {
        this.blobs.delete(path);
    }
    reset() {
        this.blobs.clear();
    }
}
/**
 * Active blob store adapter.
 * - BLOB_ACCOUNT_URL set  → AzureBlobStorage (Managed Identity)
 * - BLOB_ACCOUNT_URL unset → InMemoryBlobStore (local dev / tests)
 */
export const storage = process.env.BLOB_ACCOUNT_URL
    ? new AzureBlobStorage()
    : new InMemoryBlobStore();
