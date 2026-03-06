import { describe, expect, it, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { db } from "../src/services/db.js";
import { isGuestTokenReplay, markGuestTokenUsed, verifyGuestToken } from "../src/services/guestToken.js";
const secret = "test-secret";
describe("guest token replay", () => {
    beforeEach(() => {
        db.guestTokenJtis.clear();
        process.env.GUEST_TOKEN_SECRET = secret;
    });
    it("rejects second use of same jti", () => {
        const token = jwt.sign({
            tenantId: "tenant1",
            propertyId: "property1",
            jti: "jti-1",
            aud: "guest-registration"
        }, secret, { expiresIn: "5m" });
        const claims = verifyGuestToken(token);
        expect(isGuestTokenReplay(claims.jti)).toBe(false);
        markGuestTokenUsed(claims);
        expect(isGuestTokenReplay(claims.jti)).toBe(true);
    });
});
