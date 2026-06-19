import { describe, it, expect } from 'vitest';
import { SCHEDULE_DEFS, latestOccurrence, nextOccurrence } from './schedule';

/**
 * Occurrence math is TZ-correct: 08:00 local is NOT 08:00 UTC. These tests
 * assert across ≥2 zones, the weekly + hourly cases, and a day boundary.
 */

// Helper: the wall-clock hour an instant projects to, in a given zone.
function hourInZone(d: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false });
  const h = Number(fmt.formatToParts(d).find((p) => p.type === 'hour')!.value);
  return h === 24 ? 0 : h;
}
function weekdayInZone(d: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
  return fmt.formatToParts(d).find((p) => p.type === 'weekday')!.value;
}

describe('SCHEDULE_DEFS', () => {
  it('covers every COMPOSER_CADENCES value + daily.afternoon', () => {
    for (const k of ['hourly', 'daily.morning', 'daily.afternoon', 'daily.evening', 'weekly.monday']) {
      expect(SCHEDULE_DEFS[k]).toBeDefined();
    }
  });
});

describe('unknown key', () => {
  it('returns null (never throws)', () => {
    const now = new Date('2026-06-19T12:00:00Z');
    expect(latestOccurrence('does.not.exist', 'UTC', now)).toBeNull();
    expect(nextOccurrence('does.not.exist', 'America/New_York', now)).toBeNull();
  });
});

describe('daily.morning (08:00 local)', () => {
  it('UTC: latest at or before noon is today 08:00 UTC; next is tomorrow', () => {
    const now = new Date('2026-06-19T12:00:00Z'); // Friday noon UTC
    const latest = latestOccurrence('daily.morning', 'UTC', now)!;
    expect(latest.toISOString()).toBe('2026-06-19T08:00:00.000Z');
    expect(hourInZone(latest, 'UTC')).toBe(8);

    const next = nextOccurrence('daily.morning', 'UTC', now)!;
    expect(next.toISOString()).toBe('2026-06-20T08:00:00.000Z');
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it('America/New_York: 08:00 local is 12:00 UTC in summer (EDT, -04:00) — NOT 08:00 UTC', () => {
    const now = new Date('2026-06-19T18:00:00Z'); // afternoon NY
    const latest = latestOccurrence('daily.morning', 'America/New_York', now)!;
    // 08:00 EDT == 12:00Z
    expect(latest.toISOString()).toBe('2026-06-19T12:00:00.000Z');
    expect(hourInZone(latest, 'America/New_York')).toBe(8);
  });

  it('before this morning fired, latest steps back to yesterday (day boundary)', () => {
    // 06:00 UTC is before 08:00 UTC today → latest is yesterday 08:00 UTC.
    const now = new Date('2026-06-19T06:00:00Z');
    const latest = latestOccurrence('daily.morning', 'UTC', now)!;
    expect(latest.toISOString()).toBe('2026-06-18T08:00:00.000Z');
    const next = nextOccurrence('daily.morning', 'UTC', now)!;
    expect(next.toISOString()).toBe('2026-06-19T08:00:00.000Z');
  });

  it('NY day boundary: 06:00 UTC = 02:00 EDT, before 08:00 local → latest is YESTERDAY 08:00 local', () => {
    const now = new Date('2026-06-19T06:00:00Z'); // 02:00 EDT Fri
    const latest = latestOccurrence('daily.morning', 'America/New_York', now)!;
    expect(latest.toISOString()).toBe('2026-06-18T12:00:00.000Z'); // Thu 08:00 EDT
    expect(hourInZone(latest, 'America/New_York')).toBe(8);
  });
});

describe('daily.afternoon / daily.evening', () => {
  it('afternoon = 13:00 local, evening = 18:00 local in UTC', () => {
    const now = new Date('2026-06-19T23:00:00Z');
    expect(latestOccurrence('daily.afternoon', 'UTC', now)!.toISOString()).toBe('2026-06-19T13:00:00.000Z');
    expect(latestOccurrence('daily.evening', 'UTC', now)!.toISOString()).toBe('2026-06-19T18:00:00.000Z');
  });
});

describe('weekly.monday (Mon 08:00 local)', () => {
  it('UTC: from a Friday, latest is the most recent Monday 08:00; next is next Monday', () => {
    const now = new Date('2026-06-19T12:00:00Z'); // Friday
    const latest = latestOccurrence('weekly.monday', 'UTC', now)!;
    expect(weekdayInZone(latest, 'UTC')).toBe('Mon');
    expect(hourInZone(latest, 'UTC')).toBe(8);
    expect(latest.getTime()).toBeLessThanOrEqual(now.getTime());

    const next = nextOccurrence('weekly.monday', 'UTC', now)!;
    expect(weekdayInZone(next, 'UTC')).toBe('Mon');
    expect(hourInZone(next, 'UTC')).toBe(8);
    expect(next.getTime() - latest.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it('on Monday before 08:00 local, latest is the PREVIOUS Monday', () => {
    // 2026-06-22 is a Monday. 07:00 UTC is before 08:00 local UTC.
    const now = new Date('2026-06-22T07:00:00Z');
    const latest = latestOccurrence('weekly.monday', 'UTC', now)!;
    expect(latest.toISOString()).toBe('2026-06-15T08:00:00.000Z'); // prev Monday
    const next = nextOccurrence('weekly.monday', 'UTC', now)!;
    expect(next.toISOString()).toBe('2026-06-22T08:00:00.000Z'); // this Monday
  });

  it('Tokyo: weekly.monday resolves to Monday 08:00 JST (= Sunday 23:00 UTC)', () => {
    const now = new Date('2026-06-19T12:00:00Z'); // Friday
    const latest = latestOccurrence('weekly.monday', 'Asia/Tokyo', now)!;
    expect(weekdayInZone(latest, 'Asia/Tokyo')).toBe('Mon');
    expect(hourInZone(latest, 'Asia/Tokyo')).toBe(8);
  });
});

describe('hourly', () => {
  it('latest is the top of the current hour; next is the top of the next hour', () => {
    const now = new Date('2026-06-19T12:37:42.123Z');
    expect(latestOccurrence('hourly', 'UTC', now)!.toISOString()).toBe('2026-06-19T12:00:00.000Z');
    expect(nextOccurrence('hourly', 'UTC', now)!.toISOString()).toBe('2026-06-19T13:00:00.000Z');
  });

  it('hourly is zone-independent (top of the UTC hour either way)', () => {
    const now = new Date('2026-06-19T12:37:00Z');
    expect(latestOccurrence('hourly', 'Asia/Tokyo', now)!.toISOString()).toBe('2026-06-19T12:00:00.000Z');
  });
});

describe('DST spring-forward (regression — fixed-ms day stepping broke exactly-once)', () => {
  // 2026-03-08 02:00 EST → 03:00 EDT in America/New_York (a 23-hour day). The
  // CALENDAR day after (Mar 9), in the 00:00–00:59 local window, a fixed 24h
  // step crosses the lost hour and lands on the WRONG local day, so
  // nextOccurrence could return an instant in the PAST → re-claim/re-fire storm.
  it('daily.morning across spring-forward: latest <= now < next, on the correct local days', () => {
    // now = 2026-03-09T04:30:00Z = Mar 9 00:30 EDT (the dangerous window).
    const now = new Date('2026-03-09T04:30:00Z');
    const latest = latestOccurrence('daily.morning', 'America/New_York', now)!;
    const next = nextOccurrence('daily.morning', 'America/New_York', now)!;
    // Spring-forward occurs at 02:00 local ON Mar 8 2026, so by 08:00 NY is
    // already EDT (-04:00): Mar 8 08:00 EDT = 12:00Z.
    expect(latest.toISOString()).toBe('2026-03-08T12:00:00.000Z');
    // Mar 9 08:00 EDT = 12:00Z.
    expect(next.toISOString()).toBe('2026-03-09T12:00:00.000Z');
    expect(latest.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(hourInZone(latest, 'America/New_York')).toBe(8);
    expect(hourInZone(next, 'America/New_York')).toBe(8);
  });

  it('weekly.monday across a spring-forward week: latest <= now < next, both Monday 08:00 local', () => {
    // Spring-forward is Sun Mar 8 2026. The following Monday is Mar 9. Evaluate
    // mid-week (Wed Mar 11) — the most recent Monday occurrence is Mar 9 (post
    // transition), next is Mar 16.
    const now = new Date('2026-03-11T15:00:00Z');
    const latest = latestOccurrence('weekly.monday', 'America/New_York', now)!;
    const next = nextOccurrence('weekly.monday', 'America/New_York', now)!;
    expect(latest.toISOString()).toBe('2026-03-09T12:00:00.000Z'); // Mon Mar 9 08:00 EDT
    expect(next.toISOString()).toBe('2026-03-16T12:00:00.000Z'); // Mon Mar 16 08:00 EDT
    expect(weekdayInZone(latest, 'America/New_York')).toBe('Mon');
    expect(weekdayInZone(next, 'America/New_York')).toBe('Mon');
    expect(hourInZone(latest, 'America/New_York')).toBe(8);
    expect(hourInZone(next, 'America/New_York')).toBe(8);
    expect(latest.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it('brute-force: across the spring-forward morning, next > now at every 5-min tick', () => {
    // Sweep 2026-03-09 00:00Z → 14:00Z in 5-min steps for the DST-sensitive keys.
    const start = Date.parse('2026-03-09T00:00:00Z');
    const end = Date.parse('2026-03-09T14:00:00Z');
    for (const key of ['daily.morning', 'daily.afternoon', 'daily.evening', 'weekly.monday']) {
      for (let t = start; t <= end; t += 5 * 60 * 1000) {
        const now = new Date(t);
        const latest = latestOccurrence(key, 'America/New_York', now)!;
        const next = nextOccurrence(key, 'America/New_York', now)!;
        expect(latest.getTime()).toBeLessThanOrEqual(now.getTime());
        expect(next.getTime()).toBeGreaterThan(now.getTime());
      }
    }
  });
});

describe('DST fall-back (autumn) stays correct', () => {
  it('daily.morning across fall-back: latest <= now < next', () => {
    // 2026-11-01 02:00 EDT → 01:00 EST (a 25-hour day). Check the morning after.
    const now = new Date('2026-11-02T05:30:00Z'); // Mon Nov 2 00:30 EST
    const latest = latestOccurrence('daily.morning', 'America/New_York', now)!;
    const next = nextOccurrence('daily.morning', 'America/New_York', now)!;
    expect(latest.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(hourInZone(latest, 'America/New_York')).toBe(8);
    expect(hourInZone(next, 'America/New_York')).toBe(8);
  });
});

describe('next is always strictly after now and after latest', () => {
  it('holds for each key across zones', () => {
    const now = new Date('2026-06-19T12:00:00Z');
    for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
      for (const key of Object.keys(SCHEDULE_DEFS)) {
        const latest = latestOccurrence(key, tz, now)!;
        const next = nextOccurrence(key, tz, now)!;
        expect(latest.getTime()).toBeLessThanOrEqual(now.getTime());
        expect(next.getTime()).toBeGreaterThan(now.getTime());
      }
    }
  });
});
