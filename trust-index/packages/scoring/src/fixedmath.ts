/**
 * Internal fixed-point arithmetic (SPEC 22). Everything in the scoring path
 * is a scaled bigint at INNER decimal places. JS numbers appear only as safe
 * integers (counts, blocks, epoch seconds) and in the final display-shape
 * conversion done by JSON.parse over the canonical bytes.
 *
 * Rounding policy: every division in this module rounds half up (half away
 * from zero) via divRoundHalfUp from @trust-index/types, except the two
 * functions documented as flooring (isqrt, and therefore sqrtFx) and the
 * fractional-bit extraction in pow2NegFx, which truncates the binary tail
 * below 2^-POW2_FRAC_BITS.
 */
import { FixedNum, divRoundHalfUp } from "@trust-index/types";

/** Internal working precision, in decimal places. */
export const INNER = 12;
/** The scale factor: 10^INNER. */
export const ONE = 10n ** 12n;
export const HALF = ONE / 2n;

/** 1.96, the two-sided 95% normal quantile, at INNER precision. A fixed
 * mathematical constant of the declared interval method, not a tunable. */
export const Z95 = FixedNum.parse("1.96", INNER).scaled;

/** Multiply two INNER-scaled values, round half up. */
export function mulFx(a: bigint, b: bigint): bigint {
  return divRoundHalfUp(a * b, ONE);
}

/** Divide two INNER-scaled values, round half up. Divisor must be positive. */
export function divFx(a: bigint, b: bigint): bigint {
  return divRoundHalfUp(a * ONE, b);
}

export function clampFx(v: bigint, lo: bigint, hi: bigint): bigint {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export function minFx(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** Parse a snapshot DecimalString into an INNER-scaled bigint. Exact. */
export function parseFx(s: string): bigint {
  return FixedNum.parse(s, INNER).scaled;
}

/** Convert a safe-integer count to an INNER-scaled bigint. Exact. */
export function intFx(n: number): bigint {
  if (!Number.isSafeInteger(n)) throw new RangeError(`not a safe integer: ${n}`);
  return BigInt(n) * ONE;
}

/**
 * Floor integer square root by Newton iteration on bigints. Deterministic:
 * pure integer arithmetic, monotone descent to the floor root.
 */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError("isqrt of a negative value");
  if (n < 2n) return n;
  const bits = n.toString(2).length;
  let x = 1n << BigInt((bits >> 1) + 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/**
 * Square root of an INNER-scaled value, INNER-scaled result. Floors at the
 * last digit: sqrtFx(v) = floor(sqrt(v * ONE)), an error of at most one unit
 * in the last (12th) decimal place.
 */
export function sqrtFx(v: bigint): bigint {
  if (v < 0n) throw new RangeError("sqrtFx of a negative value");
  return isqrt(v * ONE);
}

/** Number of binary fractional digits used by pow2NegFx. */
const POW2_FRAC_BITS = 40;

let pow2Roots: bigint[] | null = null;

/**
 * Table of c_k = 2^(-2^-k) for k = 1..POW2_FRAC_BITS, computed once by
 * repeated fixed-point square roots of 1/2. Each entry carries the sqrtFx
 * floor error of at most 1 unit in the 12th decimal place.
 */
function rootTable(): bigint[] {
  if (pow2Roots === null) {
    const table: bigint[] = [];
    let c = sqrtFx(HALF);
    for (let k = 0; k < POW2_FRAC_BITS; k++) {
      table.push(c);
      c = sqrtFx(c);
    }
    pow2Roots = table;
  }
  return pow2Roots;
}

/**
 * Deterministic fixed-point 2^(-x) for x >= 0 (INNER-scaled in, INNER-scaled
 * out). Method: split x into integer part n and fraction f; 2^-f is the
 * product of c_k = 2^(-2^-k) over the first POW2_FRAC_BITS binary digits of
 * f (square-and-multiply on the root table); the result is then divided by
 * 2^n with round-half-up.
 *
 * Approximation error: the truncated binary tail of f contributes a relative
 * error under ln(2) * 2^-40 (about 6.3e-13); each of the at most 40 rounded
 * multiplications and 40 floored roots contributes at most 1 unit in the
 * 12th place, for a total absolute error well under 1e-10. The declared
 * output precisions (2 to 6 decimal places) are unaffected.
 *
 * x <= 0 returns exactly 1 (no decay for zero or clamped-negative ages).
 */
export function pow2NegFx(x: bigint): bigint {
  if (x <= 0n) return ONE;
  const n = x / ONE;
  if (n >= 64n) return 0n;
  let f = x % ONE;
  let r = ONE;
  const table = rootTable();
  for (let k = 0; k < POW2_FRAC_BITS; k++) {
    f *= 2n;
    if (f >= ONE) {
      f -= ONE;
      r = mulFx(r, table[k]!);
    }
  }
  return divRoundHalfUp(r, 2n ** n);
}
