/**
 * Warm-up ramp (§6.8): mail.nibbin.com sends low volume for the first weeks
 * so the subdomain earns its reputation before the drip launches in earnest.
 * The cap is a per-UTC-day send budget keyed off days since ramp start.
 */

/** Daily caps for warm-up weeks 1–4; beyond the schedule the cap lifts. */
export const DEFAULT_WARMUP_SCHEDULE: readonly number[] = [20, 50, 150, 400];

export function warmupDailyCap(
  warmupStart: Date,
  now: Date,
  schedule: readonly number[] = DEFAULT_WARMUP_SCHEDULE,
): number {
  const days = Math.floor((now.getTime() - warmupStart.getTime()) / 86_400_000);
  if (days < 0) return 0; // ramp hasn't started: nothing sends yet
  const week = Math.floor(days / 7);
  if (week >= schedule.length) return Number.POSITIVE_INFINITY;
  return schedule[week];
}

export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}
