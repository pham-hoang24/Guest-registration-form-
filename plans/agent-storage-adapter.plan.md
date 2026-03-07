# Storage Adapter Agent

## Goal

Replace the in-memory blob store in `backend/src/services/storage.ts` with a real Azure Blob Storage adapter using `@azure/storage-blob` and Managed Identity. The in-memory adapter must remain available for local dev and tests.

## Prerequisites

None. Runs in parallel with `agent-sql-schema` and `agent-queue-adapter`.

## Master plan reference

- [`production-readiness-master.plan.md`](production-readiness-master.plan.md)

## Existing code to read

- `backend/src/services/storage.ts` — current in-memory implementation and interface
- `backend/src/worker/processSubmission.ts` — `storage.put(blobPath, ciphertext, contentType)` and `storage.get(blobPath)`
- `backend/src/routes/owner.ts` — `storage.get(parsedRecord.blobPath)`

The blob path format is: `tenant/{tenantId}/property/{propertyId}/submission/{submissionId}.pdf.enc`

## Tasks

### 1. Read current `storage.ts` and extract the interface

The interface must match what callers expect:
```typescript
export interface BlobStore {
  put(path: string, data: Buffer, contentType: string): Promise<void>;
  get(path: string): Promise<{ ciphertext: Buffer } | null>;
  delete(path: string): Promise<void>;  // add this for retention cleanup
}
```

### 2. Install dependency

```bash
npm install @azure/storage-blob
```

`@azure/identity` is already in `package.json`.

### 3. Implement `AzureBlobStorage`

Create `backend/src/services/azureBlobStorage.ts`:

```typescript
import { BlobServiceClient, StorageSharedKeyCredential } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import type { BlobStore } from "./storage.js";

export class AzureBlobStorage implements BlobStore {
  private containerClient;

  constructor() {
    const accountUrl = process.env.BLOB_ACCOUNT_URL!;     // e.g. https://acct.blob.core.windows.net
    const container  = process.env.BLOB_CONTAINER!;        // e.g. encrypted-pdfs
    const client = new BlobServiceClient(accountUrl, new DefaultAzureCredential());
    this.containerClient = client.getContainerClient(container);
  }

  async put(path: string, data: Buffer, contentType: string): Promise<void> {
    const blockBlob = this.containerClient.getBlockBlobClient(path);
    await blockBlob.uploadData(data, {
      blobHTTPHeaders: { blobContentType: contentType },
      // Immutable storage: tags can be set here for lifecycle policies
    });
  }

  async get(path: string): Promise<{ ciphertext: Buffer } | null> {
    const blockBlob = this.containerClient.getBlockBlobClient(path);
    try {
      const buffer = await blockBlob.downloadToBuffer();
      return { ciphertext: buffer };
    } catch (err: any) {
      if (err.statusCode === 404) return null;
      throw err;
    }
  }

  async delete(path: string): Promise<void> {
    const blockBlob = this.containerClient.getBlockBlobClient(path);
    await blockBlob.deleteIfExists();
  }
}
```

**Security notes to implement:**
- Do not log blob paths that contain submission IDs (they are a form of PII correlation). If you must log, log only the prefix `tenant/{tenantId}/property/{propertyId}/` without the submission ID suffix.
- Do not set `trustServerCertificate` equivalent — use the default TLS validation.
- Content type must be set to `application/octet-stream` for encrypted blobs (never `application/pdf` — the blob content is ciphertext, not a PDF).

### 4. Wire into `storage.ts` export

```typescript
import { InMemoryBlobStore } from "./inMemoryStorage.js";
import { AzureBlobStorage } from "./azureBlobStorage.js";
import type { BlobStore } from "./blobStoreInterface.js";

export const storage: BlobStore = process.env.BLOB_ACCOUNT_URL
  ? new AzureBlobStorage()
  : new InMemoryBlobStore();
```

Keep `InMemoryBlobStore` importable directly for tests.

### 5. Verify callers need no changes

Check that `storage.put` and `storage.get` call signatures in:
- `backend/src/worker/processSubmission.ts`
- `backend/src/routes/owner.ts`

match the `BlobStore` interface. If they do, no changes needed in callers. If not, adjust the interface — not the callers.

### 6. Environment variables

Add to `backend/.env.example`:
```
BLOB_ACCOUNT_URL=https://youraccount.blob.core.windows.net
BLOB_CONTAINER=encrypted-pdfs
# Leave blank to use in-memory store locally
```

### 7. Azure Blob container setup note

Add a comment block in `azureBlobStorage.ts` noting:
- Container must be created in advance (not auto-created by app — fail loudly if missing).
- Enable soft delete on the container (7-day retention minimum).
- Enable immutability policy if regulatory compliance requires it.
- Managed Identity needs `Storage Blob Data Contributor` role on the container (not the account).

## Non-negotiable constraints

- Blobs are ciphertext. Content type stored in Azure must be `application/octet-stream`.
- The app must never store plaintext PDF bytes in blob storage.
- Blob paths must not be user-controlled — they are always constructed from server-side UUIDs.
- No SAS tokens generated with account key in the main flow. Use Managed Identity only. SAS is an optional optimization documented elsewhere.

## Definition of done

- `AzureBlobStorage` implements `BlobStore` with `put`, `get`, and `delete`.
- `BLOB_ACCOUNT_URL` unset → falls back to `InMemoryBlobStore` (local dev works without Azure).
- Callers (`processSubmission.ts`, `owner.ts`) require no changes.
- `InMemoryBlobStore` still works and existing test suite passes.
