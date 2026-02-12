export const AAD_VERSION = "1" as const;

export type AadSchemaV1 = {
  aadVersion: typeof AAD_VERSION;
  tenantId: string;
  propertyId: string;
  submissionId: string;
  templateId: string;
  templateVersion: number;
  pdfSchemaVersion: string;
  cryptoVersion: string;
};

type BuildAadInput = Omit<AadSchemaV1, "aadVersion"> & { aadVersion?: typeof AAD_VERSION };

export const buildAadBytes = (input: BuildAadInput) => {
  const aad: AadSchemaV1 = {
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

export const canonicalizeJson = (value: unknown): string => {
  return stringifyCanonical(value);
};

const stringifyCanonical = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Canonicalization does not allow non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stringifyCanonical(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
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
