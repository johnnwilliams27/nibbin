/**
 * Fixed-point arithmetic for calibration metrics.
 *
 * The published Brier score and reliability curve are claims about the system,
 * so they get the same reproducibility treatment as the scores themselves
 * (SPEC 12 publication, SPEC 22): integer arithmetic, explicit rounding, no
 * floating point. Every metric here reduces to sums, products, and exact
 * rational division, so this is cheap to hold to.
 */
import { divRoundHalfUp, formatScaled } from "@trust-index/types";

/** Working scale: 12 fractional digits, matching the scoring engine's interior precision. */
export const SCALE_DECIMALS = 12;
export const ONE = 10n ** BigInt(SCALE_DECIMALS);

/** Multiply two SCALE-scaled values, returning a SCALE-scaled value. */
export function mul(a: bigint, b: bigint): bigint {
  return divRoundHalfUp(a * b, ONE);
}

/** Divide two SCALE-scaled values, returning a SCALE-scaled value. Denominator must be positive. */
export function div(a: bigint, b: bigint): bigint {
  return divRoundHalfUp(a * ONE, b);
}

/**
 * Exact rational n/d as a SCALE-scaled value, where n and d are plain integers
 * (counts). Use divInt instead when the numerator is already SCALE-scaled.
 */
export function ratio(n: bigint, d: bigint): bigint {
  return divRoundHalfUp(n * ONE, d);
}

/** Divide an already-SCALE-scaled value by a plain integer count. */
export function divInt(scaled: bigint, count: bigint): bigint {
  return divRoundHalfUp(scaled, count);
}

/** A whole number as a SCALE-scaled value. */
export function fromInt(n: number | bigint): bigint {
  return BigInt(n) * ONE;
}

/** Parse a decimal string (e.g. "0.55") to a SCALE-scaled value. */
export function parse(s: string): bigint {
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new SyntaxError(`not a decimal string: ${JSON.stringify(s)}`);
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const dot = body.indexOf(".");
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracRaw = dot === -1 ? "" : body.slice(dot + 1);
  if (fracRaw.length > SCALE_DECIMALS) {
    throw new RangeError(`more than ${SCALE_DECIMALS} fractional digits: ${s}`);
  }
  const frac = fracRaw.padEnd(SCALE_DECIMALS, "0");
  const v = BigInt(intPart + frac);
  return neg ? -v : v;
}

/** Render a SCALE-scaled value at `decimals` fractional digits, round-half-up. */
export function format(v: bigint, decimals: number): string {
  if (decimals > SCALE_DECIMALS) throw new RangeError("cannot render beyond the working scale");
  const scaled = divRoundHalfUp(v, 10n ** BigInt(SCALE_DECIMALS - decimals));
  return formatScaled(scaled, decimals);
}

/** Convert to a JS number. Display and report rendering only; never feed back into metric math. */
export function toNumber(v: bigint): number {
  return Number(format(v, 6));
}

export function clamp(v: bigint, lo: bigint, hi: bigint): bigint {
  return v < lo ? lo : v > hi ? hi : v;
}
