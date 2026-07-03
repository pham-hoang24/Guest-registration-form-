import { describe, expect, it, vi } from "vitest";
import { processPdfJobDelivery } from "../src/consumer.js";
import type { PdfJobHandler } from "../src/messages.js";

const validMessage = {
  tenantId: "00000000-0000-0000-0000-000000000001",
  propertyId: "00000000-0000-0000-0000-000000000002",
  submissionId: "00000000-0000-0000-0000-000000000003",
};

describe("processPdfJobDelivery", () => {
  it("dead-letters an unparseable body immediately", async () => {
    const handler: PdfJobHandler = vi.fn();
    const result = await processPdfJobDelivery({
      body: { bad: "data" },
      deliveryCount: 1,
      maxDeliveryCount: 5,
      handler,
    });
    expect(result).toEqual({ outcome: "dead_letter", reason: "invalid_message_body" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("dead-letters a non-UUID tenantId immediately", async () => {
    const handler: PdfJobHandler = vi.fn();
    const result = await processPdfJobDelivery({
      body: { ...validMessage, tenantId: "not-a-uuid" },
      deliveryCount: 1,
      maxDeliveryCount: 5,
      handler,
    });
    expect(result).toEqual({ outcome: "dead_letter", reason: "invalid_message_body" });
  });

  it("returns completed when handler succeeds", async () => {
    const handler: PdfJobHandler = vi.fn().mockResolvedValue(undefined);
    const result = await processPdfJobDelivery({
      body: validMessage,
      deliveryCount: 1,
      maxDeliveryCount: 5,
      handler,
    });
    expect(result).toEqual({ outcome: "completed" });
    expect(handler).toHaveBeenCalledWith(validMessage);
  });

  it("returns retry when handler fails below the delivery cap", async () => {
    const handler: PdfJobHandler = vi.fn().mockRejectedValue(new TypeError("transient"));
    const result = await processPdfJobDelivery({
      body: validMessage,
      deliveryCount: 2,
      maxDeliveryCount: 5,
      handler,
    });
    expect(result).toEqual({ outcome: "retry", reason: "TypeError" });
  });

  it("dead-letters when handler fails at the delivery cap", async () => {
    const handler: PdfJobHandler = vi.fn().mockRejectedValue(new RangeError("overflow"));
    const result = await processPdfJobDelivery({
      body: validMessage,
      deliveryCount: 5,
      maxDeliveryCount: 5,
      handler,
    });
    expect(result).toEqual({ outcome: "dead_letter", reason: "RangeError" });
  });

  it("dead-letters when handler fails above the delivery cap", async () => {
    const handler: PdfJobHandler = vi.fn().mockRejectedValue(new Error("still failing"));
    const result = await processPdfJobDelivery({
      body: validMessage,
      deliveryCount: 6,
      maxDeliveryCount: 5,
      handler,
    });
    expect(result).toEqual({ outcome: "dead_letter", reason: "Error" });
  });

  it("uses error.name not error.message in the reason", async () => {
    class CustomError extends Error {
      override name = "DatabaseConnectionError";
    }
    const handler: PdfJobHandler = vi.fn().mockRejectedValue(new CustomError("secret dsn"));
    const result = await processPdfJobDelivery({
      body: validMessage,
      deliveryCount: 1,
      maxDeliveryCount: 5,
      handler,
    });
    expect(result).toMatchObject({ outcome: "retry", reason: "DatabaseConnectionError" });
    // error.message must NOT leak into the outcome
    expect(JSON.stringify(result)).not.toContain("secret dsn");
  });
});
