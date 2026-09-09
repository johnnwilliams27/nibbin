import { describe, expect, it } from "vitest";
import { DEFAULT_CONSTANTS } from "@trust-index/types";
import { parseConstants } from "../src/constants.js";
import { parseFx } from "../src/fixedmath.js";

describe("parseConstants", () => {
  it("parses every declared value into an INNER-scaled bigint", () => {
    const c = parseConstants(DEFAULT_CONSTANTS);
    expect(c.shrinkageK).toBe(parseFx("5.00"));
    expect(c.decayHalfLifeDays).toBe(parseFx("120"));
    expect(c.ageFloor).toBe(parseFx("0.20"));
    expect(c.weightFloor).toBe(parseFx("0.01"));
    expect(c.methodologyVersion).toBe("0.1.0");
  });

  it("cohort window converts hours to seconds exactly", () => {
    const c = parseConstants(DEFAULT_CONSTANTS);
    expect(c.cohortWindowSeconds).toBe(parseFx("24") * 3600n);
  });
});
