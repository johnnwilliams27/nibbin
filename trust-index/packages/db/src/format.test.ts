import { describe, expect, it } from "vitest";
import { isoSeconds, toFixedDecimalString, trimDecimalString } from "./format.js";

describe("isoSeconds", () => {
  it("formats at second precision with a trailing Z", () => {
    expect(isoSeconds(new Date("2026-08-01T00:00:00Z"))).toBe("2026-08-01T00:00:00Z");
    expect(isoSeconds(new Date("2026-08-01T12:34:56.789Z"))).toBe("2026-08-01T12:34:56Z");
  });
});

describe("toFixedDecimalString", () => {
  it("pads to the requested precision", () => {
    expect(toFixedDecimalString("1", 4)).toBe("1.0000");
    expect(toFixedDecimalString("0.55", 6)).toBe("0.550000");
    expect(toFixedDecimalString("184.2", 2)).toBe("184.20");
    expect(toFixedDecimalString("-3.1", 4)).toBe("-3.1000");
    expect(toFixedDecimalString("5", 0)).toBe("5");
  });
  it("refuses silent truncation", () => {
    expect(() => toFixedDecimalString("0.12345", 4)).toThrow(RangeError);
  });
  it("refuses non-decimal input", () => {
    expect(() => toFixedDecimalString("1e5", 2)).toThrow(SyntaxError);
    expect(() => toFixedDecimalString("", 2)).toThrow(SyntaxError);
  });
});

describe("trimDecimalString", () => {
  it("strips trailing fractional zeros", () => {
    expect(trimDecimalString("5.00")).toBe("5");
    expect(trimDecimalString("1.50")).toBe("1.5");
    expect(trimDecimalString("120")).toBe("120");
    expect(trimDecimalString("0.0")).toBe("0");
  });
});
