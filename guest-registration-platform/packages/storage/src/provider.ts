/**
 * Blob storage abstraction. The MVP ships LocalStorageProvider; production is
 * expected to implement this with Azure Blob Storage without touching callers.
 * Only encrypted bytes ever pass through this interface.
 */
export interface StorageProvider {
  putObject(args: { path: string; contentType: string; body: Buffer }): Promise<{ path: string }>;

  getObject(args: { path: string }): Promise<Buffer>;

  deleteObject(args: { path: string }): Promise<void>;
}
