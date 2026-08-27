import { describe, expect, it } from "vitest";
import {
  HALF,
  INNER,
  ONE,
  clampFx,
  divFx,
  intFx,
  isqrt,
  minFx,
  mulFx,
  parseFx,
  pow2NegFx,
  sqrtFx,
} from "../src/fixedmath.js";

describe("mulFx / divFx", () => {
  it("multiplies at INNER precision, round half up", () => {
    expect(mulFx(parseFx("0.5"), parseFx("0.5"))).toBe(parseFx("0.25"));
  });

  it("divides at INNER precision, round half up", () => {
    expect(divFx(parseFx("1"), parseFx("4"))).toBe(parseFx("0.25"));
  });
});

describe("clampFx / minFx", () => {
  it("clamps within bounds", () => {
    expect(clampFx(parseFx("5"), 0n, ONE)).toBe(ONE);
    expect(clampFx(-5n, 0n, ONE)).toBe(0n);
    expect(clampFx(parseFx("0.5"), 0n, ONE)).toBe(parseFx("0.5"));
  });

  it("minFx picks the smaller value", () => {
    expect(minFx(1n, 2n)).toBe(1n);
    expect(minFx(2n, 1n)).toBe(1n);
  });
});

describe("intFx", () => {
  it("scales a safe integer exactly", () => {
    expect(intFx(3)).toBe(3n * ONE);
  });

  it("rejects a non-safe-integer", () => {
    expect(() => intFx(1.5)).toThrow(RangeError);
  });
});

describe("isqrt / sqrtFx", () => {
  it("computes exact perfect-square floor roots", () => {
    expect(isqrt(0n)).toBe(0n);
    expect(isqrt(1n)).toBe(1n);
    expect(isqrt(4n)).toBe(2n);
    expect(isqrt(9n)).toBe(3n);
    expect(isqrt(100n)).toBe(10n);
  });

  it("floors non-perfect squares", () => {
    expect(isqrt(2n)).toBe(1n);
    expect(isqrt(8n)).toBe(2n);
  });

  it("rejects negative input", () => {
    expect(() => isqrt(-1n)).toThrow(RangeError);
    expect(() => sqrtFx(-1n)).toThrow(RangeError);
  });

  it("sqrtFx(1.0) is 1.0 at INNER precision", () => {
    expect(sqrtFx(ONE)).toBe(ONE);
  });

  it("sqrtFx(0.25) is close to 0.5 within floor error of one unit", () => {
    const result = sqrtFx(parseFx("0.25"));
    const diff = result > parseFx("0.5") ? result - parseFx("0.5") : parseFx("0.5") - result;
    expect(diff).toBeLessThanOrEqual(1n);
  });
});

describe("pow2NegFx", () => {
  it("returns exactly 1 for x <= 0", () => {
    expect(pow2NegFx(0n)).toBe(ONE);
    expect(pow2NegFx(-parseFx("5"))).toBe(ONE);
  });

  it("returns 0 for very large x (n >= 64)", () => {
    expect(pow2NegFx(intFx(100))).toBe(0n);
  });

  it("2^-1 is close to 0.5 within a tiny absolute error", () => {
    const result = pow2NegFx(ONE);
    const diff = result > HALF ? result - HALF : HALF - result;
    // Documented error bound: well under 1e-10 absolute.
    expect(diff).toBeLessThanOrEqual(10n ** BigInt(INNER - 10));
  });

  it("2^-2 is close to 0.25", () => {
    const result = pow2NegFx(2n * ONE);
    const target = parseFx("0.25");
    const diff = result > target ? result - target : target - result;
    expect(diff).toBeLessThanOrEqual(10n ** BigInt(INNER - 9));
  });

  it("is monotonically non-increasing as x grows", () => {
    const a = pow2NegFx(parseFx("1.5"));
    const b = pow2NegFx(parseFx("3.5"));
    expect(b).toBeLessThan(a);
  });
});
