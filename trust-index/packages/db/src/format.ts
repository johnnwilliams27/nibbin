/**
 * Formatting helpers for the boundary between Postgres rows and the wire
 * shapes in @trust-index/types. Timestamps travel as ISO-8601 UTC strings at
 * second precision; numerics travel as decimal strings and never touch a JS
 * float.
 */

/** Format a Date as ISO-8601 UTC at second precision with a trailing Z. */
export function isoSeconds(d: Date): string {
  const iso = d.toISOString();
  return iso.slice(0, 19) + "Z";
}

/**
 * Rescale a decimal string to exactly `decimals` fractional digits by digit
 * manipulation. Throws when the input carries more fractional digits than
 * requested (truncation would be silent data loss).
 */
export function toFixedDecimalString(value: string, decimals: number): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (m === null) {
    throw new SyntaxError(`not a decimal string: ${JSON.stringify(value)}`);
  }
  const sign = m[1] ?? "";
  const intPart = m[2] ?? "0";
  const fracPart = m[3] ?? "";
  if (fracPart.length > decimals) {
    throw new RangeError(`${value} has more than ${decimals} fractional digits`);
  }
  if (decimals === 0) return sign + intPart;
  return sign + intPart + "." + fracPart.padEnd(decimals, "0");
}

/** Strip trailing fractional zeros and any bare trailing dot: "5.00" becomes "5", "1.50" becomes "1.5". */
export function trimDecimalString(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/\.?0+$/, "").replace(/\.$/, "") || "0";
}
