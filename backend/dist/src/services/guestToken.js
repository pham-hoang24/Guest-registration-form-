import jwt from "jsonwebtoken";
import { db } from "./db.js";
const guestTokenSecret = process.env.GUEST_TOKEN_SECRET || "dev-guest-secret";
const guestTokenAudience = process.env.GUEST_TOKEN_AUD || "guest-registration";
export const verifyGuestToken = (token) => {
    const decoded = jwt.verify(token, guestTokenSecret, {
        audience: guestTokenAudience
    });
    const claims = {
        tenantId: String(decoded.tenantId),
        propertyId: String(decoded.propertyId),
        reservationId: decoded.reservationId ? String(decoded.reservationId) : undefined,
        jti: String(decoded.jti),
        aud: String(decoded.aud),
        exp: Number(decoded.exp),
        iat: Number(decoded.iat),
        iss: decoded.iss ? String(decoded.iss) : undefined
    };
    if (!claims.tenantId || !claims.propertyId || !claims.jti || !claims.exp || !claims.iat) {
        throw new Error("Invalid guest token claims");
    }
    return claims;
};
export const isGuestTokenReplay = (jti) => {
    return db.getGuestTokenJti(jti) !== null;
};
export const markGuestTokenUsed = (claims) => {
    db.markGuestTokenUsed({
        jti: claims.jti,
        tenantId: claims.tenantId,
        propertyId: claims.propertyId,
        usedAt: new Date().toISOString(),
        expiresAt: new Date(claims.exp * 1000).toISOString()
    });
};
