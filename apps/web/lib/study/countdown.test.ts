import { describe, it, expect } from 'vitest';
import { formatRemaining, extrapolateRemaining } from './countdown';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// formatRemaining — days-first human copy (regression for the "238:21:42" bug)
// ---------------------------------------------------------------------------

describe('formatRemaining', () => {
  it('renders a multi-day study in days + hours, NOT raw hours', () => {
    // 9d 22h21m42s — the exact shape that used to render as "238:21:42".
    const ms = 9 * DAY + 22 * HOUR + 21 * MIN + 42 * SEC;
    expect(formatRemaining(ms)).toBe('9d 22h');
    // Must not be the old hours-only format.
    expect(formatRemaining(ms)).not.toContain(':');
  });

  it('shows the full 14-day study as "14d"', () => {
    expect(formatRemaining(14 * DAY)).toBe('14d');
  });

  it('omits the hours segment at an exact day boundary', () => {
    expect(formatRemaining(3 * DAY)).toBe('3d');
  });

  it('drops to hours + minutes under a day', () => {
    expect(formatRemaining(3 * HOUR + 12 * MIN + 30 * SEC)).toBe('3h 12m');
  });

  it('shows hours only at an exact hour boundary', () => {
    expect(formatRemaining(5 * HOUR)).toBe('5h');
  });

  it('shows minutes + seconds in the final-hour tail', () => {
    expect(formatRemaining(4 * MIN + 10 * SEC)).toBe('4m 10s');
  });

  it('shows seconds only under a minute', () => {
    expect(formatRemaining(12 * SEC)).toBe('12s');
  });

  it('renders 0s at or below zero', () => {
    expect(formatRemaining(0)).toBe('0s');
    expect(formatRemaining(-5000)).toBe('0s');
  });
});

// ---------------------------------------------------------------------------
// extrapolateRemaining — the client tick (regression for the static timer)
// ---------------------------------------------------------------------------

describe('extrapolateRemaining', () => {
  it('decrements by the elapsed wall-clock since the last daemon value', () => {
    const base = 10 * MIN;
    const at = 1_000_000;
    // 90 seconds later the displayed value must have dropped by 90s.
    expect(extrapolateRemaining(base, at, at + 90 * SEC)).toBe(10 * MIN - 90 * SEC);
  });

  it('returns the base value unchanged when no time has elapsed', () => {
    expect(extrapolateRemaining(5 * MIN, 1_000_000, 1_000_000)).toBe(5 * MIN);
  });

  it('clamps to 0 once the study has expired (never negative)', () => {
    const at = 1_000_000;
    expect(extrapolateRemaining(30 * SEC, at, at + 5 * MIN)).toBe(0);
  });

  it('ignores backwards clock skew (negative elapsed treated as 0)', () => {
    const at = 1_000_000;
    expect(extrapolateRemaining(5 * MIN, at, at - 60 * SEC)).toBe(5 * MIN);
  });

  it('returns null when the base is null (remaining unknown)', () => {
    expect(extrapolateRemaining(null, 1_000_000, 2_000_000)).toBeNull();
  });

  it('feeds a value formatRemaining renders correctly (integration of the two)', () => {
    const at = 1_000_000;
    const live = extrapolateRemaining(9 * DAY + 22 * HOUR, at, at + 1 * HOUR);
    expect(live).not.toBeNull();
    // One hour elapsed -> 9d 21h.
    expect(formatRemaining(live as number)).toBe('9d 21h');
  });
});
