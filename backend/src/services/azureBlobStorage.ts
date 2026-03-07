import { BlobServiceClient, RestError } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import type { BlobStore } from "./blobStoreInterface.js";

/**
 * Azure Blob Storage adapter using Managed Identity (DefaultAzureCredential).
 *
 * Container setup requirements:
 * - The container must be created in advance. The app will throw on construction
 *   if the required environment variables are missing, and will surface Azure
 *   errors (including 404 container-not-found) at runtime. Do NOT auto-create
 *   the container from application code.
 * - Enable soft delete on the container (7-day retention minimum).
 * - Enable an immutability policy if regulatory compliance requires it.
 * - The Managed Identity must hold the "Storage Blob Data Contributor" role
 *   scoped to the specific container, not the storage account.
 *
 * Security invariants:
 * - Blob content type is always "application/octet-stream" (ciphertext, not PDF).
 * - Blob paths are constructed from server-side UUIDs only — never from
 *   user-supplied input.
 * - Blob paths contain submission IDs (PII-correlating). Do not log full paths;
 *   log only the tenant/property prefix when diagnostics are needed.
 */
export class AzureBlobStorage implements BlobStore {
  private containerClient;

  constructor() {
    const accountUrl = process.env.BLOB_ACCOUNT_URL;
    const container = process.env.BLOB_CONTAINER;
    if (!accountUrl) throw new Error("BLOB_ACCOUNT_URL is required");
    if (!container) throw new Error("BLOB_CONTAINER is required");

    const client = new BlobServiceClient(accountUrl, new DefaultAzureCredential());
    this.containerClient = client.getContainerClient(container);
  }

  async put(path: string, data: Buffer, contentType: string): Promise<void> {
    this.validatePath(path);
    if (contentType !== "application/octet-stream") {
      throw new Error(
        `Blob content type must be "application/octet-stream" for ciphertext blobs, got "${contentType}"`
      );
    }
    const blockBlob = this.containerClient.getBlockBlobClient(path);
    await blockBlob.uploadData(data, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
  }

  async get(path: string, maxBytes?: number): Promise<{ ciphertext: Buffer } | null> {
    this.validatePath(path);
    const blockBlob = this.containerClient.getBlockBlobClient(path);
    try {
      if (maxBytes !== undefined) {
        // Check blob size BEFORE allocating a buffer to prevent memory exhaustion.
        const props = await blockBlob.getProperties();
        const blobSize = props.contentLength ?? 0;
        if (blobSize > maxBytes) {
          throw new Error("blob_exceeds_max_size");
        }
      }
      const buffer = await blockBlob.downloadToBuffer();
      return { ciphertext: buffer };
    } catch (err: unknown) {
      if (err instanceof RestError && err.statusCode === 404) return null;
      throw err;
    }
  }

  async delete(path: string): Promise<void> {
    this.validatePath(path);
    const blockBlob = this.containerClient.getBlockBlobClient(path);
    const result = await blockBlob.deleteIfExists();
    if (!result.succeeded) {
      // Blob was already absent — log the path prefix only (never log the full
      // path; it contains a submission ID that is PII-correlating).
      const pathPrefix = path.split("/submission/")[0];
      console.warn(`[BlobStore] delete: blob not found at prefix ${pathPrefix}`);
    }
  }

  /**
   * Reject paths containing traversal sequences or absolute path markers.
   * Blob paths must be constructed from server-side UUIDs only.
   */
  private validatePath(path: string): void {
    if (!path || path.includes("..") || path.startsWith("/") || path.includes("\\")) {
      throw new Error("Invalid blob path: contains forbidden characters or traversal sequences");
    }
  }
}
