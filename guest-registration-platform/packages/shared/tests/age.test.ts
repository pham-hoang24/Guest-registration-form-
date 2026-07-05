import { describe, expect, it } from "vitest";
import { ageOn } from "../src/age.js";

describe("ageOn", () => {
  it("returns full years between two calendar dates", () => {
    expect(ageOn("1990-01-01", "2026-01-01")).toBe(36);
  });

  it("counts an exact birthday as the full year (turns 18 on arrival)", () => {
    expect(ageOn("2008-07-20", "2026-07-20")).toBe(18);
  });

  it("does not count the year when the birthday has not yet occurred", () => {
    expect(ageOn("2008-07-21", "2026-07-20")).toBe(17);
  });

  it("handles leap-day births", () => {
    expect(ageOn("2004-02-29", "2026-02-28")).toBe(21);
    expect(ageOn("2004-02-29", "2026-03-01")).toBe(22);
  });

  it("accepts Date objects", () => {
    expect(ageOn(new Date("2000-06-15"), new Date("2026-06-15"))).toBe(26);
  });
});
