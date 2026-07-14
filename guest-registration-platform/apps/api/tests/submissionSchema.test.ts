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

  it("rejects a missing departureDate (always required)", () => {
    const { departureDate: _omit, ...rest } = base;
    expect(payloadSchema.safeParse(rest).success).toBe(false);
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

// A valid Finnish personal identity code (henkilötunnus), birthdate 1990-04-12.
const VALID_PIC = "120490-1235";

describe("payloadSchema — PIC-or-DOB identity", () => {
  it("accepts a resident adult identified only by a valid PIC (no DOB), nationality still required", () => {
    const { countryOfEntryToFinland: _co, dateOfBirth: _d, ...rest } = primary;
    expect(
      parse({
        people: [{ ...rest, isResidentInFinland: true, finnishPersonalIdentityCode: VALID_PIC }],
      }).success,
    ).toBe(true);
  });

  it("rejects a PIC-identified resident adult with no citizenship (field 4 is always required)", () => {
    const { citizenship: _c, countryOfEntryToFinland: _co, dateOfBirth: _d, ...rest } = primary;
    expect(
      parse({
        people: [{ ...rest, isResidentInFinland: true, finnishPersonalIdentityCode: VALID_PIC }],
      }).success,
    ).toBe(false);
  });

  it("rejects a person providing both a DOB and a PIC", () => {
    expect(
      parse({ people: [{ ...primary, finnishPersonalIdentityCode: VALID_PIC }] }).success,
    ).toBe(false);
  });

  it("rejects a person providing neither a DOB nor a PIC", () => {
    const { dateOfBirth: _d, ...rest } = primary;
    expect(parse({ people: [rest] }).success).toBe(false);
  });

  it("rejects an invalid PIC (bad checksum)", () => {
    const { dateOfBirth: _d, citizenship: _c, countryOfEntryToFinland: _co, ...rest } = primary;
    expect(
      parse({
        people: [{ ...rest, isResidentInFinland: true, finnishPersonalIdentityCode: "120490-1234" }],
      }).success,
    ).toBe(false);
  });

  it("derives age from the PIC: a PIC-identified child under 18 is accepted", () => {
    // 010115A002C → born 2015-01-01, under 18 on the 2026 arrival date.
    expect(
      parse({
        people: [
          primary,
          {
            guestType: "child",
            firstName: "Kid",
            lastName: "Example",
            finnishPersonalIdentityCode: "010115A002C",
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("derives age from the PIC: a PIC-identified adult born 1990 passes the 18+ rule", () => {
    const { dateOfBirth: _d, countryOfEntryToFinland: _co, ...rest } = primary;
    expect(
      parse({
        people: [{ ...rest, isResidentInFinland: true, finnishPersonalIdentityCode: VALID_PIC }],
      }).success,
    ).toBe(true);
  });
});

describe("payloadSchema — conditional adult fields", () => {
  it("requires citizenship (field 4) unconditionally", () => {
    const { citizenship: _c, ...rest } = primary;
    expect(parse({ people: [rest] }).success).toBe(false);
  });

  it("requires countryOfEntryToFinland for a non-resident, non-Nordic adult", () => {
    const { countryOfEntryToFinland: _co, ...rest } = primary;
    expect(parse({ people: [rest] }).success).toBe(false);
  });

  it("requires countryOfEntryToFinland even for a Nordic citizen (no exemption in 3B)", () => {
    const { countryOfEntryToFinland: _co, ...rest } = primary;
    expect(parse({ people: [{ ...rest, citizenship: "FI" }] }).success).toBe(false);
  });

  it("does not require countryOfEntryToFinland for a resident adult", () => {
    const { countryOfEntryToFinland: _co, ...rest } = primary;
    expect(parse({ people: [{ ...rest, isResidentInFinland: true }] }).success).toBe(true);
  });

  it("does not require documentNumber for a Nordic citizen who supplies country of entry", () => {
    const { documentNumber: _dn, ...rest } = primary;
    expect(
      parse({ people: [{ ...rest, citizenship: "SE", countryOfEntryToFinland: "SE" }] }).success,
    ).toBe(true);
  });

  it("requires documentNumber for a non-resident, non-Nordic, DOB-identified adult", () => {
    const { documentNumber: _dn, ...rest } = primary;
    expect(parse({ people: [rest] }).success).toBe(false);
  });

  it("requires documentNumber for a non-resident, non-Nordic adult even with a Finnish PIC (field 6 has no PIC exemption)", () => {
    const { documentNumber: _dn, dateOfBirth: _d, ...rest } = primary;
    expect(
      parse({ people: [{ ...rest, finnishPersonalIdentityCode: VALID_PIC }] }).success,
    ).toBe(false);
  });

  it("rejects an unknown country code for citizenship", () => {
    expect(parse({ people: [{ ...primary, citizenship: "XX" }] }).success).toBe(false);
  });

  it("normalizes a lowercase country code", () => {
    const r = parse({ people: [{ ...primary, citizenship: "de", countryOfEntryToFinland: "se" }] });
    expect(r.success).toBe(true);
    if (r.success) {
      const p = r.data.people[0] as { citizenship?: string; countryOfEntryToFinland?: string };
      expect(p.citizenship).toBe("DE");
      expect(p.countryOfEntryToFinland).toBe("SE");
    }
  });
});

describe("payloadSchema — family riders reject adult-only fields", () => {
  const spouseBase = {
    guestType: "spouse" as const,
    firstName: "Minh",
    lastName: "Example",
    dateOfBirth: "1992-02-02",
  };

  it.each(["documentNumber", "countryOfEntryToFinland", "citizenship", "isResidentInFinland", "address"])(
    "rejects %s on a spouse (strict schema)",
    (field) => {
      const r = parse({ people: [primary, { ...spouseBase, [field]: "x" }] });
      expect(r.success).toBe(false);
      expect(!r.success && hasUnrecognizedKey(r.error.issues, field)).toBe(true);
    },
  );

  it("accepts a spouse identified by a valid PIC instead of a DOB", () => {
    const { dateOfBirth: _d, ...rest } = spouseBase;
    expect(
      parse({ people: [primary, { ...rest, finnishPersonalIdentityCode: VALID_PIC }] }).success,
    ).toBe(true);
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
