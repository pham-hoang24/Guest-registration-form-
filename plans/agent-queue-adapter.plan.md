# Queue Adapter Agent

## Goal

Replace the in-memory queue in `backend/src/services/queue.ts` with a real Azure Service Bus adapter using `@azure/service-bus` and Managed Identity. The in-memory adapter must remain available for local dev and tests. Wire the worker to consume real Service Bus messages.

## Prerequisites

None. Runs in parallel with `agent-sql-schema` and `agent-storage-adapter`.

## Master plan reference

- [`production-readiness-master.plan.md`](production-readiness-master.plan.md)

## Existing code to read

- `backend/src/services/queue.ts` — current in-memory queue implementation
- `backend/src/routes/registration.ts` — calls `enqueue({ submissionId })`
- `backend/src/worker/index.ts` — worker entry point; how it dequeues jobs
- `backend/src/worker/processSubmission.ts` — `SubmissionJob` type

## Tasks

### 1. Read `queue.ts` and `worker/index.ts` and extract the interface

Define a `Queue` interface and a `Worker` (consumer) interface:
```typescript
export interface Queue {
  enqueue(job: { submissionId: string }): Promise<void>;
}

export interface QueueWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

### 2. Install dependency

```bash
npm install @azure/service-bus
```

`@azure/identity` is already installed.

### 3. Implement `AzureServiceBusSender` (producer — used by API)

Create `backend/src/services/azureServiceBusSender.ts`:

```typescript
import { ServiceBusClient } from "@azure/service-bus";
import { DefaultAzureCredential } from "@azure/identity";
import type { Queue } from "./queue.js";

export class AzureServiceBusSender implements Queue {
  private namespace: string;
  private queueName: string;

  constructor() {
    this.namespace = process.env.SERVICE_BUS_NAMESPACE!; // e.g. your-namespace.servicebus.windows.net
    this.queueName = process.env.SERVICE_BUS_QUEUE!;
  }

  async enqueue(job: { submissionId: string }): Promise<void> {
    const client = new ServiceBusClient(this.namespace, new DefaultAzureCredential());
    const sender = client.createSender(this.queueName);
    try {
      await sender.sendMessages({
        body: job,
        contentType: "application/json",
        subject: "submission_job"
      });
    } finally {
      await sender.close();
      await client.close();
    }
  }
}
```

Note: Creating a new client per message is safe for low-throughput scenarios. For high throughput, maintain a long-lived client. For MVP, per-message is fine.

### 4. Implement `AzureServiceBusReceiver` (consumer — used by worker)

Create `backend/src/services/azureServiceBusReceiver.ts`:

```typescript
import { ServiceBusClient, type ServiceBusReceivedMessage } from "@azure/service-bus";
import { DefaultAzureCredential } from "@azure/identity";
import { processSubmissionJob } from "../worker/processSubmission.js";
import type { SubmissionJob } from "../worker/processSubmission.js";
import type { QueueWorker } from "./queue.js";

export class AzureServiceBusReceiver implements QueueWorker {
  private client: ServiceBusClient;
  private receiver: ReturnType<ServiceBusClient["createReceiver"]> | null = null;

  constructor() {
    this.client = new ServiceBusClient(
      process.env.SERVICE_BUS_NAMESPACE!,
      new DefaultAzureCredential()
    );
  }

  async start(): Promise<void> {
    const queueName = process.env.SERVICE_BUS_QUEUE!;
    this.receiver = this.client.createReceiver(queueName, { receiveMode: "peekLock" });

    this.receiver.subscribe({
      processMessage: async (message: ServiceBusReceivedMessage) => {
        const job = message.body as SubmissionJob;
        try {
          await processSubmissionJob(job);
          await this.receiver!.completeMessage(message);
        } catch (err) {
          // Dead-letter after maxDeliveryCount (configured on queue, default 10)
          await this.receiver!.abandonMessage(message);
        }
      },
      processError: async (err) => {
        console.error("Service Bus receive error", err);
      }
    });
  }

  async stop(): Promise<void> {
    await this.receiver?.close();
    await this.client.close();
  }
}
```

**Dead letter queue:** Service Bus automatically moves messages to DLQ after `maxDeliveryCount` delivery attempts. The worker uses `abandonMessage` to allow retries. The existing `WORKER_MAX_ATTEMPTS` check in `processSubmissionJob` is the application-level guard; Service Bus DLQ is the infrastructure safety net. Both should be active.

### 5. Wire into queue exports

Update `backend/src/services/queue.ts`:
```typescript
import { InMemoryQueue } from "./inMemoryQueue.js";
import { AzureServiceBusSender } from "./azureServiceBusSender.js";

export const queue: Queue = process.env.SERVICE_BUS_NAMESPACE
  ? new AzureServiceBusSender()
  : new InMemoryQueue();

export const enqueue = (job: { submissionId: string }) => queue.enqueue(job);
```

Update `backend/src/worker/index.ts` to use `AzureServiceBusReceiver` when configured:
```typescript
import { AzureServiceBusReceiver } from "../services/azureServiceBusReceiver.js";
import { InMemoryWorker } from "../services/inMemoryWorker.js";

const worker: QueueWorker = process.env.SERVICE_BUS_NAMESPACE
  ? new AzureServiceBusReceiver()
  : new InMemoryWorker();

await worker.start();
```

### 6. Environment variables

Add to `backend/.env.example`:
```
SERVICE_BUS_NAMESPACE=your-namespace.servicebus.windows.net
SERVICE_BUS_QUEUE=submission-jobs
# Leave blank to use in-memory queue locally
```

### 7. Azure Service Bus setup notes

Add a comment block in `azureServiceBusReceiver.ts` noting:
- Queue must be created with dead-letter enabled (`requiresDuplicateDetection: false`, `enableDeadLetteringOnMessageExpiration: true`).
- Set `maxDeliveryCount` to match or exceed `WORKER_MAX_ATTEMPTS` (default 5 in app, set queue to 10 for buffer).
- Managed Identity needs `Azure Service Bus Data Sender` role for API, `Azure Service Bus Data Receiver` role for Worker — principle of least privilege.
- Message TTL should be set to align with max expected processing time (e.g. 24h).

## Non-negotiable constraints

- Worker uses `peekLock` receive mode — not `receiveAndDelete`. Messages must be explicitly completed or abandoned.
- Never log message body if it contains submission IDs linked to PII. Log only `submissionId` at INFO level.
- The in-memory queue must remain functional when `SERVICE_BUS_NAMESPACE` is unset.

## Definition of done

- `AzureServiceBusSender.enqueue()` sends messages to Service Bus when `SERVICE_BUS_NAMESPACE` is set.
- `AzureServiceBusReceiver.start()` subscribes and calls `processSubmissionJob` for each message.
- Successful jobs → `completeMessage`. Failed jobs → `abandonMessage` (retried up to DLQ limit).
- `SERVICE_BUS_NAMESPACE` unset → falls back to in-memory queue and worker.
- Existing test suite passes with in-memory fallback.
