import { BlobServiceClient } from "@azure/storage-blob";
import type { StorageProvider } from "./provider.js";

/**
 * Minimal container surface used by the provider. Tests inject fakes;
 * production uses the real @azure/storage-blob container client via
 * {@link azureBlobContainer}.
 */
export type BlobContainer = {
  uploadBlob(args: { path: string; body: Buffer; contentType: string }): Promise<void>;
  downloadBlob(args: { path: string }): Promise<Buffer>;
  deleteBlob(args: { path: string }): Promise<void>;
};

export function azureBlobContainer(args: {
  connectionString: string;
  containerName: string;
}): BlobContainer {
  const container = BlobServiceClient.fromConnectionString(
    args.connectionString,
  ).getContainerClient(args.containerName);
  return {
    async uploadBlob({ path, body, contentType }) {
      await container.getBlockBlobClient(path).uploadData(body, {
        blobHTTPHeaders: { blobContentType: contentType },
      });
    },
    async downloadBlob({ path }) {
      return container.getBlockBlobClient(path).downloadToBuffer();
    },
    async deleteBlob({ path }) {
      await container.getBlockBlobClient(path).deleteIfExists();
    },
  };
}

/**
 * StorageProvider backed by Azure Blob Storage. The container must already
 * exist (provisioned via IaC); the runtime identity only needs data-plane
 * blob read/write/delete, not container management.
 *
 * Blob names are virtual paths, not filesystem paths, but the same hygiene
 * rules as LocalStorageProvider are enforced so a compromised path value
 * cannot address blobs outside the expected layout.
 */
export class AzureBlobStorageProvider implements StorageProvider {
  constructor(private readonly container: BlobContainer) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): AzureBlobStorageProvider {
    const connectionString = env.AZURE_STORAGE_CONNECTION_STRING;
    const containerName = env.AZURE_BLOB_CONTAINER_NAME;
    if (!connectionString || !containerName) {
      throw new Error(
        "AZURE_STORAGE_CONNECTION_STRING and AZURE_BLOB_CONTAINER_NAME must be set for STORAGE_PROVIDER=azure-blob",
      );
    }
    return new AzureBlobStorageProvider(azureBlobContainer({ connectionString, containerName }));
  }

  private assertSafePath(objectPath: string): void {
    if (
      objectPath.length === 0 ||
      objectPath.startsWith("/") ||
      objectPath.includes("\\") ||
      objectPath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw new Error("Invalid object path");
    }
  }

  async putObject(args: { path: string; contentType: string; body: Buffer }): Promise<{
    path: string;
  }> {
    this.assertSafePath(args.path);
    await this.container.uploadBlob(args);
    return { path: args.path };
  }

  async getObject(args: { path: string }): Promise<Buffer> {
    this.assertSafePath(args.path);
    return this.container.downloadBlob(args);
  }

  async deleteObject(args: { path: string }): Promise<void> {
    this.assertSafePath(args.path);
    await this.container.deleteBlob(args);
  }
}
