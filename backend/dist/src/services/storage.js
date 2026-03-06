import { Readable } from "node:stream";
class InMemoryStorage {
    blobs = new Map();
    async put(path, ciphertext, contentType) {
        this.blobs.set(path, { ciphertext, contentType });
    }
    async exists(path) {
        return this.blobs.has(path);
    }
    async get(path) {
        return this.blobs.get(path) ?? null;
    }
    async getStream(path) {
        const blob = this.blobs.get(path);
        if (!blob)
            return null;
        return Readable.from(blob.ciphertext);
    }
    reset() {
        this.blobs.clear();
    }
}
export const storage = new InMemoryStorage();
