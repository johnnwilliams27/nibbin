/**
 * Display-only number formatting. Every numeric field on a ScoreResult is
 * already a JS number at its declared PRECISION (see @trust-index/types
 * fixed.ts); this module only controls how those numbers are printed. It
 * never feeds a formatted value back into scoring.
 */

/** Score / score_low / score_high on the 0-100 display scale, 2 fractional digits. */
export function formatScore(v: number): string {
  return v.toFixed(2);
}

/** confidence in [0,1], printed as a 4-digit decimal (matches PRECISION.confidence). */
export function formatConfidence(v: number): string {
  return v.toFixed(4);
}

/** n_eff, 2 fractional digits (matches PRECISION.n_eff). */
export function formatNEff(v: number): string {
  return v.toFixed(2);
}

/** Reviewer weight in (0,1], 4 fractional digits (matches PRECISION.weight). */
export function formatWeight(v: number): string {
  return v.toFixed(4);
}

/** Signal ratios / shares, 4 fractional digits (matches PRECISION.signal). */
export function formatSignalRatio(v: number): string {
  return v.toFixed(4);
}

/** ISO-8601 timestamp to a plain UTC date-time string, no relative phrasing. */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC").replace(/Z$/, " UTC");
}

/** ISO-8601 timestamp to a plain UTC date. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

/** Truncates a 0x address to a fixed-width display form: 0x1234...abcd. */
export function shortAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-4)}`;
}

/** Renders any signal value (number | string | boolean | null) for a table cell. */
export function formatSignalValue(v: number | string | boolean | null): string {
  if (v === null) return "not recorded";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(4);
  return v;
}

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return n === 1 ? singular : plural;
}
