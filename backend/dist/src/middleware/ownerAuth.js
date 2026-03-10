import { createPublicKey } from "node:crypto";
import jwt from "jsonwebtoken";
const ownerJwtSecret = process.env.OWNER_JWT_SECRET || "dev-owner-secret";
const OWNER_JWKS_URI = process.env.OWNER_JWKS_URI;
// Audience and issuer are optional but strongly recommended in production.
// When set, jwt.verify enforces them; when unset, those claims are not checked.
// In production set OWNER_JWT_AUD to your API identifier and OWNER_JWT_ISS to
// your IdP issuer URL to prevent token-confusion attacks.
const OWNER_JWT_AUD = process.env.OWNER_JWT_AUD || undefined;
const OWNER_JWT_ISS = process.env.OWNER_JWT_ISS || undefined;
const HS256_OPTIONS = {
    algorithms: ["HS256"],
    audience: OWNER_JWT_AUD,
    issuer: OWNER_JWT_ISS
};
const RS256_OPTIONS = {
    algorithms: ["RS256"],
    audience: OWNER_JWT_AUD,
    issuer: OWNER_JWT_ISS
};
const JWKS_TTL_MS = 5 * 60_000; // 5 minutes
let jwksCache = null;
// Deduplicates concurrent cache refreshes — only one fetch in-flight at a time.
let inflightFetch = null;
/** Guard against SSRF/MITM via a misconfigured or compromised env var. */
function assertHttpsUri(uri) {
    if (!uri.startsWith("https://")) {
        throw new Error(`OWNER_JWKS_URI must use HTTPS to prevent MITM and SSRF attacks (got: ${uri.slice(0, 20)}…)`);
    }
}
async function fetchJwksEntries(uri) {
    const res = await fetch(uri);
    if (!res.ok)
        throw new Error(`JWKS fetch error: ${res.status}`);
    const body = await res.json();
    if (!body || typeof body !== "object" || !Array.isArray(body.keys)) {
        throw new Error("Invalid JWKS response: missing or non-array 'keys' property");
    }
    const entries = [];
    for (const jwk of body.keys) {
        if (!jwk || typeof jwk !== "object")
            continue;
        const k = jwk;
        if (k.kty !== "RSA")
            continue; // only RSA keys
        if (k.use && k.use !== "sig")
            continue; // only signing keys
        if (k.alg && k.alg !== "RS256")
            continue; // only RS256 (when alg is present)
        try {
            entries.push({
                kid: typeof k.kid === "string" ? k.kid : undefined,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                key: createPublicKey({ key: jwk, format: "jwk" })
            });
        }
        catch {
            // Skip keys that can't be imported (malformed, wrong curve, etc.)
        }
    }
    if (entries.length === 0) {
        throw new Error("JWKS response contained no usable RSA signing keys");
    }
    return entries;
}
async function getJwksKeys(uri) {
    const now = Date.now();
    if (jwksCache && now - jwksCache.cachedAt < JWKS_TTL_MS) {
        return jwksCache.entries;
    }
    // Return the existing in-flight promise so concurrent calls share one fetch.
    if (inflightFetch)
        return inflightFetch;
    inflightFetch = fetchJwksEntries(uri)
        .then((entries) => {
        jwksCache = { entries, cachedAt: Date.now() };
        return entries;
    })
        .finally(() => {
        inflightFetch = null;
    });
    return inflightFetch;
}
async function verifyRs256(token) {
    const header = jwt.decode(token, { complete: true })?.header;
    const kid = header?.kid;
    const entries = await getJwksKeys(OWNER_JWKS_URI);
    // Prefer key matching kid; fall back to trying all keys when kid is absent.
    const candidates = kid ? entries.filter((e) => e.kid === kid) : entries;
    if (candidates.length === 0) {
        throw new Error("No matching JWKS key found");
    }
    for (const { key } of candidates) {
        try {
            return jwt.verify(token, key, RS256_OPTIONS);
        }
        catch {
            // try next candidate
        }
    }
    throw new Error("RS256 signature verification failed");
}
/** Exported for tests — clears caches so tests can inject fake JWKS state. */
export function clearJwksCacheForTests() {
    jwksCache = null;
    inflightFetch = null;
}
// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function parseOwnerFromPayload(decoded) {
    return {
        userId: String(decoded.sub ?? ""),
        tenantId: String(decoded.tenantId ?? ""),
        propertyIds: Array.isArray(decoded.propertyIds) ? decoded.propertyIds.map(String) : []
    };
}
/**
 * Middleware: requires Authorization: Bearer <token>.
 *
 * - OWNER_JWKS_URI set  → RS256/OIDC mode (production).
 *   URI must be HTTPS. Set OWNER_JWT_AUD + OWNER_JWT_ISS in production.
 * - OWNER_JWKS_URI unset → HS256 mode (dev/test) with OWNER_JWT_SECRET.
 *
 * Attaches req.owner = { userId, tenantId, propertyIds }. Returns 401 on failure.
 */
export function requireOwnerAuth(req, res, next) {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
        res.status(401).json({ error: "unauthorized" });
        return;
    }
    const token = header.slice(7);
    if (OWNER_JWKS_URI) {
        try {
            assertHttpsUri(OWNER_JWKS_URI); // fail fast on misconfiguration
        }
        catch {
            // Return 500 — this is a server configuration error, not an auth failure.
            res.status(500).json({ error: "misconfigured_auth" });
            return;
        }
        verifyRs256(token)
            .then((decoded) => {
            req.owner = parseOwnerFromPayload(decoded);
            next();
        })
            .catch(() => {
            res.status(401).json({ error: "unauthorized" });
        });
    }
    else {
        try {
            const decoded = jwt.verify(token, ownerJwtSecret, HS256_OPTIONS);
            req.owner = parseOwnerFromPayload(decoded);
            next();
        }
        catch {
            res.status(401).json({ error: "unauthorized" });
        }
    }
}
/**
 * Extracts and verifies owner identity from Authorization: Bearer <token>.
 * Returns null if header is missing or JWT is invalid.
 * Prefer using requireOwnerAuth middleware and req.owner in route handlers.
 */
export function getOwnerFromRequest(req) {
    return req.owner ?? null;
}
