/**
 * Schedule semantics — the single source of truth for interpreting a Nibbin's
 * `{kind:'schedule', schedule:<key>}` triggers (design 2026-06-19). Pure, no
 * I/O: the cron route and unit tests both import these. Covers every value in
 * `COMPOSER_CADENCES` plus the template cadences.
 *
 * All occurrence math is TIMEZONE-CORRECT via `Intl.DateTimeFormat`: an entry
 * like `daily.morning` means 08:00 in the *account's* IANA zone, NOT 08:00 UTC.
 * We never construct a `Date` from local wall-clock components directly (that
 * would use the SERVER's zone); instead we compute the UTC instant whose
 * wall-clock projection into the target zone equals the desired components.
 */

/** A schedule definition: the local wall-clock rule, in the account's zone. */
export interface ScheduleDef {
  /** 'hourly' fires at minute 0 of every hour; 'daily'/'weekly' at hour:00. */
  cadence: 'hourly' | 'daily' | 'weekly';
  /** Local hour 0..23 (ignored for 'hourly'). */
  hour?: number;
  /** 0=Sunday … 1=Monday … 6=Saturday (only for 'weekly'). */
  weekday?: number;
}

/**
 * The canonical schedule map. Keys mirror `COMPOSER_CADENCES`
 * (`daily.morning|daily.evening|weekly.monday|hourly`) plus `daily.afternoon`
 * used by templates. An unknown key is not in this map → callers skip it.
 */
export const SCHEDULE_DEFS: Readonly<Record<string, ScheduleDef>> = {
  hourly: { cadence: 'hourly' },
  'daily.morning': { cadence: 'daily', hour: 8 },
  'daily.afternoon': { cadence: 'daily', hour: 13 },
  'daily.evening': { cadence: 'daily', hour: 18 },
  'weekly.monday': { cadence: 'weekly', hour: 8, weekday: 1 },
};

/** Local wall-clock components of `instant` AS SEEN in IANA zone `tz`. */
interface ZonedParts {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  hour: number; // 0..23
  minute: number;
  second: number;
  weekday: number; // 0=Sun … 6=Sat
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * Project a UTC instant into a target zone's wall-clock components. Uses
 * `Intl.DateTimeFormat` with the explicit `timeZone`, which is the only
 * dependency-free way to read another zone's local time correctly across DST.
 */
function partsInZone(instant: Date, tz: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  let hour = Number(parts.hour);
  // `hour12:false` can render midnight as '24' in some engines — normalize.
  if (hour === 24) hour = 0;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
  };
}

/**
 * The UTC instant whose projection into `tz` is exactly the given local
 * wall-clock components (y/m/d hh:00:00). Two-pass solve: a first guess via
 * `Date.UTC` is corrected by the zone's offset at that guess, and the offset is
 * re-read once at the corrected instant to settle DST boundaries. This lands on
 * the intended local time across DST in practice for top-of-hour schedules.
 */
function instantForLocal(tz: string, year: number, month: number, day: number, hour: number): Date {
  const targetUTC = Date.UTC(year, month - 1, day, hour, 0, 0);
  // offsetMs(at) = (wall-clock-in-tz expressed as UTC) - (the actual instant).
  const offsetMsAt = (at: number): number => {
    const p = partsInZone(new Date(at), tz);
    const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return asUTC - at;
  };
  let guess = targetUTC - offsetMsAt(targetUTC);
  guess = targetUTC - offsetMsAt(guess);
  return new Date(guess);
}

/** Days to subtract from `from` to reach the most recent `weekday` (0..6), inclusive of today. */
function daysBackToWeekday(from: number, weekday: number): number {
  return (from - weekday + 7) % 7;
}

/**
 * The most recent instant at or before `now` that the schedule should have
 * fired (in the account's zone). Returns null for an unknown key.
 */
export function latestOccurrence(key: string, tz: string, now: Date): Date | null {
  const def = SCHEDULE_DEFS[key];
  if (!def) return null;

  if (def.cadence === 'hourly') {
    // Minute 0 of the current hour — truncate to the hour boundary.
    const ms = now.getTime();
    return new Date(ms - (ms % (60 * 60 * 1000)));
  }

  const p = partsInZone(now, tz);
  const hour = def.hour ?? 0;

  if (def.cadence === 'daily') {
    // Today at hour:00 local; if that's still in the future, step back one day.
    let cand = instantForLocal(tz, p.year, p.month, p.day, hour);
    if (cand.getTime() > now.getTime()) {
      const back = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const bp = partsInZone(back, tz);
      cand = instantForLocal(tz, bp.year, bp.month, bp.day, hour);
    }
    return cand;
  }

  // weekly: the most recent `weekday` at hour:00 local at or before now.
  const weekday = def.weekday ?? 0;
  const back = daysBackToWeekday(p.weekday, weekday);
  const dayInstant = new Date(now.getTime() - back * 24 * 60 * 60 * 1000);
  const dp = partsInZone(dayInstant, tz);
  let cand = instantForLocal(tz, dp.year, dp.month, dp.day, hour);
  if (cand.getTime() > now.getTime()) {
    // The target weekday is today but hour:00 hasn't arrived — go back a full week.
    const prev = new Date(dayInstant.getTime() - 7 * 24 * 60 * 60 * 1000);
    const pp = partsInZone(prev, tz);
    cand = instantForLocal(tz, pp.year, pp.month, pp.day, hour);
  }
  return cand;
}

/**
 * The next instant STRICTLY AFTER `now` that the schedule should fire (in the
 * account's zone). Returns null for an unknown key.
 */
export function nextOccurrence(key: string, tz: string, now: Date): Date | null {
  const def = SCHEDULE_DEFS[key];
  if (!def) return null;

  if (def.cadence === 'hourly') {
    const ms = now.getTime();
    const hourMs = 60 * 60 * 1000;
    return new Date(ms - (ms % hourMs) + hourMs);
  }

  const latest = latestOccurrence(key, tz, now);
  if (!latest) return null;
  const hour = def.hour ?? 0;

  if (def.cadence === 'daily') {
    // One local day after `latest` (re-resolve through the zone for DST).
    const nextDay = new Date(latest.getTime() + 24 * 60 * 60 * 1000);
    const np = partsInZone(nextDay, tz);
    return instantForLocal(tz, np.year, np.month, np.day, hour);
  }

  // weekly: one local week after `latest`.
  const nextWeek = new Date(latest.getTime() + 7 * 24 * 60 * 60 * 1000);
  const np = partsInZone(nextWeek, tz);
  return instantForLocal(tz, np.year, np.month, np.day, hour);
}
