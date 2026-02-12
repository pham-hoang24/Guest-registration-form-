import { Readable } from "node:stream";

type StoredBlob = {
  ciphertext: Buffer;
  contentType: string;
};

class InMemoryStorage {
  blobs = new Map<string, StoredBlob>();

  async put(path: string, ciphertext: Buffer, contentType: string) {
    this.blobs.set(path, { ciphertext, contentType });
  }

  async exists(path: string) {
    return this.blobs.has(path);
  }

  async get(path: string) {
    return this.blobs.get(path) ?? null;
  }

  async getStream(path: string) {
    const blob = this.blobs.get(path);
    if (!blob) return null;
    return Readable.from(blob.ciphertext);
  }
}

export const storage = new InMemoryStorage();
