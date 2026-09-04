/**
 * Known-answer tests for the divergence statistics. These decide whether a gap
 * between linkage arms is real, so they need to be right independently of the
 * data they will be pointed at.
 */
import { describe, expect, it } from "vitest";
import { format, parse, sqrt } from "./fixed.js";
import { aucStandardError, proportionStandardError, testDifference } from "./divergence.js";

describe("sqrt", () => {
  it("computes exact roots of perfect squares", () => {
    expect(format(sqrt(parse("4")), 4)).toBe("2.0000");
    expect(format(sqrt(parse("0.25")), 4)).toBe("0.5000");
    expect(format(sqrt(parse("1")), 4)).toBe("1.0000");
    expect(sqrt(0n)).toBe(0n);
  });
  it("approximates an irrational root", () => {
    expect(format(sqrt(parse("2")), 6)).toBe("1.414214"); // 1.41421356... rounds half up
  });
  it("rejects a negative input", () => {
    expect(() => sqrt(parse("-1"))).toThrow(RangeError);
  });
});

describe("proportionStandardError", () => {
  it("matches the hand-computed sqrt(p(1-p)/n)", () => {
    // p=0.5, n=100 -> sqrt(0.25/100) = 0.05
    expect(format(proportionStandardError(parse("0.5"), 100)!, 4)).toBe("0.0500");
  });
  it("shrinks as the sample grows", () => {
    const small = proportionStandardError(parse("0.5"), 100)!;
    const large = proportionStandardError(parse("0.5"), 10_000)!;
    expect(large < small).toBe(true);
  });
  it("is null for an empty sample", () => {
    expect(proportionStandardError(parse("0.5"), 0)).toBeNull();
  });
});

describe("aucStandardError", () => {
  it("shrinks as the sample grows", () => {
    const small = aucStandardError(parse("0.8"), 50, 50)!;
    const large = aucStandardError(parse("0.8"), 5000, 5000)!;
    expect(large < small).toBe(true);
  });
  it("is null without both classes", () => {
    expect(aucStandardError(parse("0.8"), 0, 50)).toBeNull();
    expect(aucStandardError(parse("0.8"), 50, 0)).toBeNull();
  });
});

describe("testDifference", () => {
  it("calls a small gap on a small sample insignificant", () => {
    // The exact case that made a fixed 0.05 cutoff misfire: two random halves
    // of the same data differing by chance.
    const se = proportionStandardError(parse("0.5"), 200);
    const t = testDifference(parse("0.52"), parse("0.48"), se, se);
    expect(t.significant).toBe(false);
  });

  it("calls the same gap significant on a large sample", () => {
    const se = proportionStandardError(parse("0.5"), 100_000);
    const t = testDifference(parse("0.52"), parse("0.48"), se, se);
    expect(t.significant).toBe(true);
  });

  it("reports the gap in units of its own standard error", () => {
    const se = proportionStandardError(parse("0.5"), 100);
    const t = testDifference(parse("0.6"), parse("0.5"), se, se);
    // gap 0.1, each SE 0.05, combined SE = sqrt(0.05^2+0.05^2) ~ 0.0707
    expect(format(t.seFx!, 4)).toBe("0.0707");
    expect(format(t.sigmaFx!, 2)).toBe("1.41");
  });

  it("refuses to call anything significant without an uncertainty estimate", () => {
    const t = testDifference(parse("0.9"), parse("0.1"), null, null);
    expect(t.significant).toBe(false);
  });

  it("returns nulls when either side has no estimate", () => {
    const t = testDifference(null, parse("0.5"), null, null);
    expect(t.gapFx).toBeNull();
    expect(t.significant).toBe(false);
  });
});
