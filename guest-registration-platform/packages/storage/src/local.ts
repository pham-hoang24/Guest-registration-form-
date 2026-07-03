import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageProvider } from "./provider.js";

/**
 * Filesystem-backed provider for local development. Object paths are
 * validated to stay inside the root directory (no traversal, no absolute
 * paths).
 */
export class LocalStorageProvider implements StorageProvider {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  private resolveSafe(objectPath: string): string {
    if (path.isAbsolute(objectPath)) {
      throw new Error("Object path must be relative");
    }
    const resolved = path.resolve(this.rootDir, objectPath);
    if (resolved !== this.rootDir && !resolved.startsWith(this.rootDir + path.sep)) {
      throw new Error("Object path escapes storage root");
    }
    return resolved;
  }

  async putObject(args: { path: string; contentType: string; body: Buffer }): Promise<{
    path: string;
  }> {
    const target = this.resolveSafe(args.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, args.body);
    return { path: args.path };
  }

  async getObject(args: { path: string }): Promise<Buffer> {
    return readFile(this.resolveSafe(args.path));
  }

  async deleteObject(args: { path: string }): Promise<void> {
    await rm(this.resolveSafe(args.path), { force: true });
  }
}

export async function storageProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<StorageProvider> {
  const provider = env.STORAGE_PROVIDER ?? "local";
  if (provider === "local") {
    return new LocalStorageProvider(env.LOCAL_STORAGE_DIR ?? "./.local-storage");
  }
  if (provider === "azure-blob") {
    const { AzureBlobStorageProvider } = await import("./azureBlob.js");
    return AzureBlobStorageProvider.fromEnv(env);
  }
  throw new Error(`Unsupported STORAGE_PROVIDER: ${provider}`);
}

/** Canonical blob path for an encrypted submission PDF. */
export function encryptedPdfBlobPath(args: {
  tenantId: string;
  propertyId: string;
  submissionId: string;
}): string {
  return `tenant/${args.tenantId}/property/${args.propertyId}/submission/${args.submissionId}.pdf.enc`;
}
