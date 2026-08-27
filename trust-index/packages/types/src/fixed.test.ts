import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical.js";
import { FixedNum, divRoundHalfUp, formatScaled, rescale } from "./fixed.js";
import { encodeMethodologyVersion } from "./oracle.js";

describe("FixedNum", () => {
  it("parses and formats exactly", () => {
    expect(FixedNum.parse("61.42", 2).scaled).toBe(6142n);
    expect(FixedNum.parse("0.11", 4).toDecimalString()).toBe("0.1100");
    expect(FixedNum.parse("-3.5", 2).toDecimalString()).toBe("-3.50");
    expect(FixedNum.parse("100", 2).toDecimalString()).toBe("100.00");
    expect(formatScaled(5n, 4)).toBe("0.0005");
    expect(formatScaled(-5n, 4)).toBe("-0.0005");
    expect(formatScaled(0n, 0)).toBe("0");
  });

  it("rejects excess precision and malformed strings", () => {
    expect(() => FixedNum.parse("1.234", 2)).toThrow(RangeError);
    expect(() => FixedNum.parse("1e3", 2)).toThrow(SyntaxError);
    expect(() => FixedNum.parse("+1", 2)).toThrow(SyntaxError);
    expect(() => FixedNum.parse(".5", 2)).toThrow(SyntaxError);
  });

  it("rounds half up, away from zero", () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divRoundHalfUp(4n, 2n)).toBe(2n);
    expect(rescale(12345n, 4, 2)).toBe(123n);
    expect(rescale(12355n, 4, 2)).toBe(124n);
    expect(rescale(12n, 2, 4)).toBe(1200n);
  });
});

describe("canonicalJson", () => {
  it("sorts keys, strips whitespace, formats FixedNum unquoted", () => {
    const s = canonicalJson({
      b: new FixedNum(6142n, 2),
      a: [1, null, "x"],
      c: { z: true, y: new FixedNum(1100n, 4) },
    });
    expect(s).toBe('{"a":[1,null,"x"],"b":61.42,"c":{"y":0.1100,"z":true}}');
  });

  it("rejects fractional JS numbers and undefined", () => {
    expect(() => canonicalJson({ x: 0.5 })).toThrow(TypeError);
    expect(() => canonicalJson({ x: undefined as never })).toThrow(TypeError);
  });

  it("is stable under key insertion order", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
});

describe("oracle encoding", () => {
  it("encodes methodology semver", () => {
    expect(encodeMethodologyVersion("0.1.0")).toBe(1000);
    expect(encodeMethodologyVersion("2.10.3")).toBe(2_010_003);
    expect(() => encodeMethodologyVersion("1.0")).toThrow(SyntaxError);
  });
});
