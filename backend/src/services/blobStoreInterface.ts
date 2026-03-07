export interface BlobStore {
  put(path: string, data: Buffer, contentType: string): Promise<void>;
  /**
   * Download a blob. Pass `maxBytes` to refuse downloads that exceed the
   * limit — the implementation must check the blob size before allocating a
   * buffer so that an oversized blob never enters memory.
   */
  get(path: string, maxBytes?: number): Promise<{ ciphertext: Buffer } | null>;
  delete(path: string): Promise<void>;
}
