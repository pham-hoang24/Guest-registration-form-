import { describe, expect, it } from "vitest";
import {
  isValidFinnishPic,
  finnishPicBirthDate,
  parseFinnishPic,
  normalizeFinnishPic,
} from "../src/finnishPic.js";

describe("finnishPic", () => {
  it("accepts valid codes across centuries and derives the birth date", () => {
    expect(finnishPicBirthDate("131052-308T")).toBe("1952-10-13"); // 1900s '-'
    expect(finnishPicBirthDate("120490-1235")).toBe("1990-04-12");
    expect(finnishPicBirthDate("010115A002C")).toBe("2015-01-01"); // 2000s 'A'
  });

  it("is case-insensitive and trims surrounding whitespace", () => {
    expect(isValidFinnishPic("  010115a002c  ")).toBe(true);
    expect(normalizeFinnishPic("  010115a002c ")).toBe("010115A002C");
  });

  it("rejects a wrong checksum", () => {
    expect(isValidFinnishPic("120490-1234")).toBe(false);
    expect(finnishPicBirthDate("120490-1234")).toBeNull();
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "not-a-pic", "1204901235", "12049O-1235", "999999-999X"]) {
      expect(isValidFinnishPic(bad)).toBe(false);
    }
  });

  it("rejects an impossible calendar date even with a correct checksum", () => {
    // 31 February 1952, individual 002, checksum '3' is arithmetically correct —
    // only the calendar-date check rejects it.
    expect(isValidFinnishPic("310252-0023")).toBe(false);
  });

  it("rejects an unknown century sign", () => {
    expect(isValidFinnishPic("120490Z1235")).toBe(false);
  });

  it("parseFinnishPic returns null for invalid, object for valid", () => {
    expect(parseFinnishPic("nope")).toBeNull();
    expect(parseFinnishPic("120490-1235")).toEqual({ birthDate: "1990-04-12" });
  });
});
