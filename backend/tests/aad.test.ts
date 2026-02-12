import { describe, expect, it } from "vitest";
import { buildAadBytes, canonicalizeJson } from "../src/crypto/aad.js";
import { assertHashMatch, sha256Hex } from "../src/crypto/hashes.js";

describe("aad canonicalization", () => {
  it("produces stable output regardless of key order", () => {
    const inputA = {
      tenantId: "t1",
      propertyId: "p1",
      submissionId: "s1",
      templateId: "default",
      templateVersion: 1,
      pdfSchemaVersion: "1.0",
      cryptoVersion: "AES-256-GCM"
    };
    const inputB = {
      cryptoVersion: "AES-256-GCM",
      pdfSchemaVersion: "1.0",
      templateId: "default",
      templateVersion: 1,
      submissionId: "s1",
      propertyId: "p1",
      tenantId: "t1"
    };
    const aadA = buildAadBytes(inputA);
    const aadB = buildAadBytes(inputB);
    expect(aadA.toString("utf8")).toBe(aadB.toString("utf8"));
  });

  it("canonicalizes nested objects deterministically", () => {
    const value = { b: 2, a: { d: 4, c: 3 } };
    expect(canonicalizeJson(value)).toBe('{"a":{"c":3,"d":4},"b":2}');
  });

  it("detects AAD hash mismatch", () => {
    const aad = buildAadBytes({
      tenantId: "t1",
      propertyId: "p1",
      submissionId: "s1",
      templateId: "default",
      templateVersion: 1,
      pdfSchemaVersion: "1.0",
      cryptoVersion: "AES-256-GCM"
    });
    const aadHash = sha256Hex(aad);
    const tampered = aadHash.replace(/^./, aadHash[0] === "a" ? "b" : "a");
    expect(() => assertHashMatch(aadHash, tampered, "AAD hash")).toThrow(/AAD hash/);
  });
});
