import { describe, expect, it, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { db, InMemoryDb } from "../src/services/db.js";
import { isGuestTokenReplay, markGuestTokenUsed, verifyGuestToken } from "../src/services/guestToken.js";

const secret = "test-secret";

describe("guest token replay", () => {
  beforeEach(() => {
    (db as InMemoryDb).reset();
    process.env.GUEST_TOKEN_SECRET = secret;
  });

  it("rejects second use of same jti", async () => {
    const token = jwt.sign(
      {
        tenantId: "tenant1",
        propertyId: "property1",
        jti: "jti-1",
        aud: "guest-registration"
      },
      secret,
      { expiresIn: "5m" }
    );

    const claims = verifyGuestToken(token);
    expect(await isGuestTokenReplay(claims.jti)).toBe(false);
    await markGuestTokenUsed(claims);
    expect(await isGuestTokenReplay(claims.jti)).toBe(true);
  });
});
