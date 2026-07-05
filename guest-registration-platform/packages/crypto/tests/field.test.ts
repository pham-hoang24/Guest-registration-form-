import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptString, encryptString, LocalKmsProvider } from "../src/index.js";

const kms = new LocalKmsProvider(randomBytes(32).toString("base64"));
const context = {
  tenantId: "tenant-1",
  propertyId: "property-1",
  guestSubmissionId: "submission-1",
  passengerCardId: "card-1",
  guestId: "guest-1",
  field: "documentNumber",
};

describe("field encryption", () => {
  it("round trips a document number", async () => {
    const sealed = await encryptString({ plaintext: "X1234567", context, kms });
    expect(sealed).not.toContain("X1234567");
    const opened = await decryptString({ sealed, context, kms });
    expect(opened).toBe("X1234567");
  });

  it("rejects a sealed value moved to another submission", async () => {
    const sealed = await encryptString({ plaintext: "X1234567", context, kms });
    await expect(
      decryptString({ sealed, context: { ...context, guestSubmissionId: "submission-2" }, kms }),
    ).rejects.toThrow(/AAD mismatch/);
  });
});
