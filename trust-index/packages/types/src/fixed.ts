/**
 * Fixed-point decimal representation used everywhere a non-integer number
 * crosses a determinism boundary (snapshot input, score output, inputs_hash).
 *
 * SPEC §22: no floating point in scoring; explicit rounding; canonical JSON
 * with explicit number formatting. A DecimalString is the wire form; FixedNum
 * is the arithmetic form (scaled bigint). Conversions are exact or they throw.
 */

/** A decimal number in string form: `-?\d+(\.\d+)?`, no exponent, no leading `+`. */
export type DecimalString = string;

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** Scaled-integer fixed-point value: `scaled / 10^decimals`. */
export class FixedNum {
  readonly scaled: bigint;
  readonly decimals: number;

  constructor(scaled: bigint, decimals: number) {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
      throw new RangeError(`decimals out of range: ${decimals}`);
    }
    this.scaled = scaled;
    this.decimals = decimals;
  }

  /** Parse a DecimalString into a FixedNum at exactly `decimals` places. Throws if it does not fit exactly. */
  static parse(s: DecimalString, decimals: number): FixedNum {
    if (!DECIMAL_RE.test(s)) throw new SyntaxError(`not a decimal string: ${JSON.stringify(s)}`);
    const neg = s.startsWith("-");
    const body = neg ? s.slice(1) : s;
    const dot = body.indexOf(".");
    const intPart = dot === -1 ? body : body.slice(0, dot);
    const fracPart = dot === -1 ? "" : body.slice(dot + 1);
    if (fracPart.length > decimals) {
      throw new RangeError(`${s} has more than ${decimals} fractional digits`);
    }
    const padded = fracPart.padEnd(decimals, "0");
    const scaled = BigInt(intPart + padded) * (neg ? -1n : 1n);
    return new FixedNum(scaled, decimals);
  }

  /** Format as a DecimalString with exactly `this.decimals` fractional digits (zero-padded, no trailing trim). */
  toDecimalString(): DecimalString {
    return formatScaled(this.scaled, this.decimals);
  }

  /** Convert to a JS number. Only for display paths; never feed the result back into scoring. */
  toNumber(): number {
    return Number(this.scaled) / 10 ** this.decimals;
  }
}

/** Format a scaled bigint at `decimals` places into a DecimalString. Pure integer digit manipulation. */
export function formatScaled(scaled: bigint, decimals: number): DecimalString {
  const neg = scaled < 0n;
  const abs = (neg ? -scaled : scaled).toString().padStart(decimals + 1, "0");
  const intPart = abs.slice(0, abs.length - decimals) || "0";
  const fracPart = decimals === 0 ? "" : abs.slice(abs.length - decimals);
  return (neg ? "-" : "") + intPart + (decimals === 0 ? "" : "." + fracPart);
}

/** Round-half-up integer division: divide `a` by `b`, rounding half away from zero. `b` must be positive. */
export function divRoundHalfUp(a: bigint, b: bigint): bigint {
  if (b <= 0n) throw new RangeError("divisor must be positive");
  const neg = a < 0n;
  const abs = neg ? -a : a;
  const q = (abs * 2n + b) / (2n * b);
  return neg ? -q : q;
}

/** Rescale a scaled value from one decimal precision to another, round-half-up. */
export function rescale(scaled: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (fromDecimals === toDecimals) return scaled;
  if (toDecimals > fromDecimals) return scaled * 10n ** BigInt(toDecimals - fromDecimals);
  return divRoundHalfUp(scaled, 10n ** BigInt(fromDecimals - toDecimals));
}

/**
 * Output precisions (fractional digits) for every non-integer field in a
 * ScoreResult. These are part of the methodology: golden files, inputs_hash
 * and anchored leaves all format numbers at exactly these precisions.
 */
export const PRECISION = {
  /** score, score_low, score_high on the 0-100 display scale */
  score: 2,
  /** confidence in [0,1] */
  confidence: 4,
  /** n_eff (sum of weights) */
  n_eff: 2,
  /** individual reviewer weight in (0,1] */
  weight: 4,
  /** normalized feedback value in [0,1] */
  value: 6,
  /** signal ratios (cohort shares, funder shares, etc.) */
  signal: 4,
} as const;
