export const AAD_VERSION = "1";
export const buildAadBytes = (input) => {
    const aad = {
        aadVersion: input.aadVersion ?? AAD_VERSION,
        tenantId: input.tenantId,
        propertyId: input.propertyId,
        submissionId: input.submissionId,
        templateId: input.templateId,
        templateVersion: input.templateVersion,
        pdfSchemaVersion: input.pdfSchemaVersion,
        cryptoVersion: input.cryptoVersion
    };
    const canonical = canonicalizeJson(aad);
    return Buffer.from(canonical, "utf8");
};
export const buildPayloadAadBytes = (input) => {
    const aad = {
        purpose: "payload",
        aadVersion: input.aadVersion ?? AAD_VERSION,
        tenantId: input.tenantId,
        propertyId: input.propertyId,
        submissionId: input.submissionId,
        schemaVersion: input.schemaVersion,
        cryptoVersion: input.cryptoVersion
    };
    const canonical = canonicalizeJson(aad);
    return Buffer.from(canonical, "utf8");
};
export const canonicalizeJson = (value) => {
    return stringifyCanonical(value);
};
const stringifyCanonical = (value) => {
    if (value === null)
        return "null";
    if (typeof value === "string")
        return JSON.stringify(value);
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error("Canonicalization does not allow non-finite numbers");
        }
        return JSON.stringify(value);
    }
    if (typeof value === "boolean")
        return value ? "true" : "false";
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stringifyCanonical(entry)).join(",")}]`;
    }
    if (typeof value === "object") {
        const obj = value;
        const keys = Object.keys(obj).sort();
        const entries = keys.map((key) => {
            if (obj[key] === undefined) {
                throw new Error(`Canonicalization does not allow undefined for key ${key}`);
            }
            return `${JSON.stringify(key)}:${stringifyCanonical(obj[key])}`;
        });
        return `{${entries.join(",")}}`;
    }
    throw new Error("Canonicalization does not allow unsupported types");
};
