/**
 * Canonical JSON serialization (SPEC §22): sorted keys, no whitespace,
 * explicit number formatting. This is the byte contract for inputs_hash,
 * golden fixture files, and anchored leaves.
 *
 * Rules:
 * - Object keys sorted by UTF-16 code unit order, recursively.
 * - No whitespace anywhere.
 * - Numbers never come from JS doubles. A numeric leaf is either
 *   an `int` (safe integer, emitted as-is) or a FixedNum (emitted as its
 *   fixed-precision digit string, unquoted, e.g. `61.42` or `0.1100`).
 * - Strings JSON-escaped per JSON.stringify.
 * - undefined is illegal; use null explicitly.
 */
import { FixedNum } from "./fixed.js";

export type CanonicalValue =
  | null
  | boolean
  | string
  | number // MUST be a safe integer; fractional JS numbers throw
  | FixedNum
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export function canonicalJson(v: CanonicalValue): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) {
      throw new TypeError(
        `canonicalJson: non-integer JS number ${v}; use FixedNum for fractional values`,
      );
    }
    return v.toString();
  }
  if (v instanceof FixedNum) return v.toDecimalString();
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  if (typeof v === "object") {
    const keys = Object.keys(v).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const val = v[k];
      if (val === undefined) throw new TypeError(`canonicalJson: undefined at key ${k}`);
      parts.push(JSON.stringify(k) + ":" + canonicalJson(val));
    }
    return "{" + parts.join(",") + "}";
  }
  throw new TypeError(`canonicalJson: unsupported value ${String(v)}`);
}
