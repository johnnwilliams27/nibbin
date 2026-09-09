/**
 * Field Study countdown helpers — pure, side-effect-free, unit-tested.
 *
 * Two concerns live here so the `/app/study` page and the dashboard
 * `DesktopOrStudyCard` share ONE implementation (they previously each carried a
 * private `formatCountdown` that rendered hours-not-days and never ticked):
 *
 *   1. formatRemaining(ms)            — human "9d 22h" / "3h 12m" / "4m 10s" copy.
 *   2. extrapolateRemaining(...)      — client-side tick: derive the live
 *                                       remaining-ms from the last daemon value
 *                                       plus elapsed wall-clock, so the number
 *                                       counts down smoothly between (and even
 *                                       without) daemon pushes.
 *
 * Why extrapolate rather than poll the bridge each second: the daemon already
 * pushes a fresh `study:status` (carrying a freshly-read remaining_ms) ~1×/sec,
 * but the UI must keep ticking even if a push is dropped or delayed, and must
 * never re-invoke a native command on a timer. Anchoring to the last received
 * value + a local clock gives a monotonic, drift-bounded countdown that any new
 * daemon value simply re-anchors.
 */

const MS_PER_SEC = 1000;
const MS_PER_MIN = 60 * MS_PER_SEC;
const MS_PER_HOUR = 60 * MS_PER_MIN;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Format a remaining-millisecond duration as days-first human copy.
 *
 *   >= 1 day   -> "9d 22h"   (days + hours; hours omitted only at exact day)
 *   >= 1 hour  -> "3h 12m"   (hours + minutes)
 *   >= 1 min   -> "4m 10s"   (minutes + seconds — the live tail near the end)
 *   < 1 min    -> "12s"      (seconds)
 *   <= 0       -> "0s"
 *
 * Days are the headline unit for a 14-day field study (the old formatter showed
 * "238:21:42", i.e. raw hours, which read as broken). The two-unit cap keeps the
 * label glanceable while still moving every render near the end of a study.
 */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return '0s';

  const days = Math.floor(ms / MS_PER_DAY);
  const hours = Math.floor((ms % MS_PER_DAY) / MS_PER_HOUR);
  const mins = Math.floor((ms % MS_PER_HOUR) / MS_PER_MIN);
  const secs = Math.floor((ms % MS_PER_MIN) / MS_PER_SEC);

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Derive the live remaining-ms from the last daemon-reported value.
 *
 * @param baseMs    remaining_ms as last reported by the daemon (null when unknown).
 * @param baseAtMs  Date.now() captured at the moment baseMs was received.
 * @param nowMs     current Date.now().
 *
 * Returns null when baseMs is null (nothing to count down). Never returns a
 * negative number — clamps to 0 so the formatter shows "0s" at/after expiry.
 *
 * Anchoring to a captured timestamp (rather than mutating a stored counter)
 * means a paused study can freeze the countdown simply by NOT advancing baseAt
 * on the caller side, and a fresh daemon value always re-anchors cleanly.
 */
export function extrapolateRemaining(
  baseMs: number | null,
  baseAtMs: number,
  nowMs: number,
): number | null {
  if (baseMs === null) return null;
  const elapsed = Math.max(0, nowMs - baseAtMs);
  return Math.max(0, baseMs - elapsed);
}
