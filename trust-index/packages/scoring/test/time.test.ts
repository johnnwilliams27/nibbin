import { describe, expect, it } from "vitest";
import { floorDaysBetween, parseIsoUtcSeconds } from "../src/time.js";

describe("parseIsoUtcSeconds", () => {
  it("parses a known instant exactly (epoch)", () => {
    expect(parseIsoUtcSeconds("1970-01-01T00:00:00Z")).toBe(0);
  });

  it("parses a leap-day timestamp", () => {
    // 2024-02-29 exists (2024 is a leap year); one day after is 2024-03-01.
    const feb29 = parseIsoUtcSeconds("2024-02-29T00:00:00Z");
    const mar01 = parseIsoUtcSeconds("2024-03-01T00:00:00Z");
    expect(mar01 - feb29).toBe(86400);
  });

  it("round-trips a modern date consistently with days-between arithmetic", () => {
    const a = parseIsoUtcSeconds("2026-08-01T00:00:00Z");
    const b = parseIsoUtcSeconds("2026-07-01T00:00:00Z");
    expect(floorDaysBetween(a, b)).toBe(31);
  });

  it("rejects a non-ISO string", () => {
    expect(() => parseIsoUtcSeconds("2026-08-01")).toThrow(SyntaxError);
  });

  it("rejects an out-of-range month", () => {
    expect(() => parseIsoUtcSeconds("2026-13-01T00:00:00Z")).toThrow(RangeError);
  });

  it("rejects an out-of-range day for the given month", () => {
    expect(() => parseIsoUtcSeconds("2026-02-30T00:00:00Z")).toThrow(RangeError);
  });

  it("rejects Feb 29 in a non-leap year", () => {
    expect(() => parseIsoUtcSeconds("2026-02-29T00:00:00Z")).toThrow(RangeError);
  });

  it("rejects an out-of-range hour/minute/second", () => {
    expect(() => parseIsoUtcSeconds("2026-08-01T24:00:00Z")).toThrow(RangeError);
    expect(() => parseIsoUtcSeconds("2026-08-01T00:60:00Z")).toThrow(RangeError);
    expect(() => parseIsoUtcSeconds("2026-08-01T00:00:60Z")).toThrow(RangeError);
  });
});

describe("floorDaysBetween", () => {
  it("floors a fractional-day gap down", () => {
    const a = parseIsoUtcSeconds("2026-08-01T12:00:00Z");
    const b = parseIsoUtcSeconds("2026-08-01T00:00:00Z");
    expect(floorDaysBetween(a, b)).toBe(0);
  });

  it("throws when a < b", () => {
    expect(() => floorDaysBetween(0, 1)).toThrow(RangeError);
  });
});
