/**
 * Feedback normalization (SPEC 11.10). Feedback is a signed fixed-point
 * value, not a fixed scale. The index build detects a scale per
 * (client_address, tag1) pair and attaches it to each entry as raw-value
 * bounds; this module normalizes within those bounds.
 *
 * Rules:
 * - detected_scale null: the entry is unusable and excluded (never guessed).
 * - Degenerate scale (max_raw <= min_raw): also unusable; a single observed
 *   point defines no scale. Recorded in docs/NOTES-track-b.md.
 * - Raw values outside the detected bounds clamp to the bounds.
 * - The normalized value is rounded half up at PRECISION.value (6 decimal
 *   places) and then scaled exactly to the internal precision.
 *
 * value_decimals cancels out: bounds and value share the same fixed-point
 * scale, so the ratio is computed directly on the raw integers.
 */
import type { FeedbackEntry } from "@trust-index/types";
import { PRECISION, divRoundHalfUp } from "@trust-index/types";
import { INNER } from "./fixedmath.js";

const VALUE_SCALE = 10n ** BigInt(PRECISION.value);
const VALUE_TO_INNER = 10n ** BigInt(INNER - PRECISION.value);

/**
 * Normalize a feedback entry's value to [0,1] at INNER precision, or null
 * when the entry is unusable (uninferable or degenerate scale).
 */
export function normalizeValue(entry: FeedbackEntry): bigint | null {
  if (entry.detected_scale === null) return null;
  const min = BigInt(entry.detected_scale.min_raw);
  const max = BigInt(entry.detected_scale.max_raw);
  if (max <= min) return null;
  const raw = BigInt(entry.value_raw);
  const clamped = raw < min ? min : raw > max ? max : raw;
  const atValuePrecision = divRoundHalfUp((clamped - min) * VALUE_SCALE, max - min);
  return atValuePrecision * VALUE_TO_INNER;
}
