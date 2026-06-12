/**
 * Per-user local time, computed from IANA tz via Intl — no tz database dep.
 * users.tz is user-controlled input (GOTCHA: the router budget bug): a bad or
 * hostile value must never crash the worker, and flipping tz must never mint
 * an extra push (the scheduler pairs local-day dedup with an absolute-time
 * spacing floor for exactly that reason).
 */

export const FALLBACK_TZ = 'UTC';

export function safeTz(tz: string | null | undefined): string {
  if (!tz) return FALLBACK_TZ;
  try {
    // Throws RangeError on unknown zones.
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch {
    return FALLBACK_TZ;
  }
}

/** YYYY-MM-DD calendar day of `at` in the user's tz. */
export function localDay(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz(tz),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Local hour 0–23 of `at` in the user's tz. */
export function localHour(at: Date, tz: string): number {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz(tz),
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(at);
  return Number(h);
}

/**
 * Whole calendar days from `start`'s local day to `now`'s local day.
 * This is the arc day: the evening of the hatch is day 0, the next local
 * morning is day 1 — matching how a person counts "the day after I hatched".
 */
export function arcDay(start: Date, now: Date, tz: string): number {
  const a = localDay(start, tz);
  const b = localDay(now, tz);
  // Compare via UTC midnights of the calendar labels — DST-proof because the
  // labels themselves already absorbed the offset.
  const toUtcMidnight = (day: string): number => Date.parse(`${day}T00:00:00Z`);
  return Math.round((toUtcMidnight(b) - toUtcMidnight(a)) / 86_400_000);
}
