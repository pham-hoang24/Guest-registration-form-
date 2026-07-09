import { z } from "zod";
import { describe, expect, it } from "vitest";
import { payloadSchema } from "../src/domain/submissionSchema.js";

const primary = {
  guestType: "primary",
  firstName: "Anna",
  lastName: "Example",
  dateOfBirth: "1990-04-12",
  isResidentInFinland: false,
  citizenship: "DE",
  countryOfEntryToFinland: "SE",
  address: "Example Street 1",
  documentNumber: "X1234567",
};

const base = {
  arrivalDate: "2026-07-20",
  departureDate: "2026-07-23",
  departureDateKnown: true,
  purposeOfStay: "Leisure",
  privacyAccepted: true,
  accuracyConfirmed: true,
  people: [primary],
};

const parse = (overrides: Record<string, unknown> = {}) =>
  payloadSchema.safeParse({ ...base, ...overrides });

describe("payloadSchema — dates", () => {
  it("accepts a same-day stay (departure == arrival)", () => {
    expect(parse({ arrivalDate: "2026-07-20", departureDate: "2026-07-20" }).success).toBe(true);
  });

  it("accepts departure after arrival", () => {
    expect(parse({ departureDate: "2026-07-25" }).success).toBe(true);
  });

  it("rejects departure before arrival", () => {
    expect(parse({ departureDate: "2026-07-19" }).success).toBe(false);
  });

  it("accepts a future arrival date", () => {
    expect(parse({ arrivalDate: "2099-01-01", departureDate: "2099-01-02" }).success).toBe(true);
  });

  it("accepts unknown departure (departureDateKnown=false, no departureDate)", () => {
    const { departureDate: _omit, ...rest } = base;
    expect(payloadSchema.safeParse({ ...rest, departureDateKnown: false }).success).toBe(true);
  });

  it("rejects known departure with no departureDate", () => {
    const { departureDate: _omit, ...rest } = base;
    expect(payloadSchema.safeParse({ ...rest, departureDateKnown: true }).success).toBe(false);
  });
});

describe("payloadSchema — purpose & primary", () => {
  it("accepts Meeting as a purpose of stay", () => {
    expect(parse({ purposeOfStay: "Meeting" }).success).toBe(true);
  });

  it("requires exactly one primary", () => {
    expect(parse({ people: [] }).success).toBe(false);
    expect(parse({ people: [primary, { ...primary }] }).success).toBe(false);
  });
});

describe("payloadSchema — age boundaries", () => {
  it("passes primary exactly 18 on arrival", () => {
    expect(parse({ people: [{ ...primary, dateOfBirth: "2008-07-20" }] }).success).toBe(true);
  });

  it("fails primary under 18 on arrival", () => {
    expect(parse({ people: [{ ...primary, dateOfBirth: "2008-07-21" }] }).success).toBe(false);
  });

  it("passes a child under 18 and fails a child who is 18 on arrival", () => {
    const child = { guestType: "child", firstName: "Kid", lastName: "Example" };
    expect(parse({ people: [primary, { ...child, dateOfBirth: "2015-01-01" }] }).success).toBe(true);
    expect(parse({ people: [primary, { ...child, dateOfBirth: "2008-07-20" }] }).success).toBe(
      false,
    );
  });
});

describe("payloadSchema — identity & country of entry", () => {
  it("accepts a Finnish personal identity code without DOB citizenship extras", () => {
    const { citizenship: _c, countryOfEntryToFinland: _co, ...rest } = primary;
    expect(
      parse({ people: [{ ...rest, finnishPersonalIdentityCode: "010190-1234" }] }).success,
    ).toBe(true);
  });

  it("requires citizenship when no PIC is provided", () => {
    const { citizenship: _c, ...rest } = primary;
    expect(parse({ people: [rest] }).success).toBe(false);
  });

  it("requires countryOfEntryToFinland for a non-resident, non-Nordic adult", () => {
    const { countryOfEntryToFinland: _co, ...rest } = primary;
    expect(parse({ people: [rest] }).success).toBe(false);
  });

  it("does not require countryOfEntryToFinland for a resident adult", () => {
    const { countryOfEntryToFinland: _co, ...rest } = primary;
    expect(parse({ people: [{ ...rest, isResidentInFinland: true }] }).success).toBe(true);
  });

  it("does not require countryOfEntryToFinland for a Nordic citizen", () => {
    const { countryOfEntryToFinland: _co, ...rest } = primary;
    expect(parse({ people: [{ ...rest, citizenship: "FI" }] }).success).toBe(true);
  });
});

describe("payloadSchema — reduced family members", () => {
  it("accepts spouse and child with name + DOB only", () => {
    expect(
      parse({
        people: [
          primary,
          { guestType: "spouse", firstName: "Minh", lastName: "Example", dateOfBirth: "1992-02-02" },
          { guestType: "child", firstName: "Linh", lastName: "Example", dateOfBirth: "2016-03-03" },
        ],
      }).success,
    ).toBe(true);
  });
});

function hasUnrecognizedKey(issues: z.ZodIssue[], key: string): boolean {
  return issues.some(
    (i) => i.code === z.ZodIssueCode.unrecognized_keys && i.keys.includes(key),
  );
}

describe("payloadSchema — rejects unknown fields", () => {
  it("rejects an unknown top-level field", () => {
    const r = parse({ hackerField: 1 });
    expect(r.success).toBe(false);
    expect(!r.success && hasUnrecognizedKey(r.error.issues, "hackerField")).toBe(true);
  });

  it("rejects an unknown person-level field", () => {
    const r = parse({ people: [{ ...primary, extra: true }] });
    expect(r.success).toBe(false);
    expect(!r.success && hasUnrecognizedKey(r.error.issues, "extra")).toBe(true);
  });

  // Data minimization: these fields are no longer collected and must be rejected.
  it.each(["documentType", "email", "phone", "countryOfResidence"])(
    "rejects the removed field %s",
    (field) => {
      const r = parse({ people: [{ ...primary, [field]: "x" }] });
      expect(r.success).toBe(false);
      expect(!r.success && hasUnrecognizedKey(r.error.issues, field)).toBe(true);
    },
  );
});

describe("payloadSchema — text normalization", () => {
  it("NFC-normalizes and collapses whitespace in names", () => {
    // "A" + combining ring above → single NFC codepoint "Å"; internal whitespace collapses.
    const r = parse({ people: [{ ...primary, firstName: "Å  nna", lastName: "  Example  " }] });
    expect(r.success).toBe(true);
    if (r.success) {
      const p = r.data.people[0] as { firstName: string; lastName: string };
      expect(p.firstName).toBe("Å nna");
      expect(p.lastName).toBe("Example");
    }
  });

  it("rejects control characters in a name", () => {
    expect(parse({ people: [{ ...primary, firstName: `An${String.fromCharCode(8)}na` }] }).success).toBe(false);
  });

  it("rejects an obvious script payload in the address", () => {
    expect(parse({ people: [{ ...primary, address: "<script>alert(1)</script>" }] }).success).toBe(
      false,
    );
  });

  it("rejects an over-long address (max 300)", () => {
    expect(parse({ people: [{ ...primary, address: "x".repeat(301) }] }).success).toBe(false);
  });

  it("accepts unicode names (Vietnamese + Nordic)", () => {
    expect(
      parse({ people: [{ ...primary, firstName: "Nguyễn", lastName: "Hoàng Åström" }] }).success,
    ).toBe(true);
  });
});
