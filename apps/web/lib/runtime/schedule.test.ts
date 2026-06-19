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
