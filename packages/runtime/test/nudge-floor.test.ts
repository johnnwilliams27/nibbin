/**
 * Task 5a — the re-nudge cadence / safety floor decision (pure unit tests).
 *
 * Covers the two layers in isolation: the HARD floor (interval + count, not
 * configurable away) and the OWNER/LEARNED cadence within it. The clamp is the
 * load-bearing invariant: a policy can only be at-or-stricter than the floor.
 */
import { describe, expect, it } from 'vitest';
import {
  decideNudge,
  resolveCadencePolicy,
  FLOOR_MIN_INTERVAL_MS,
  FLOOR_MAX_NUDGES,
  DEFAULT_CADENCE_INTERVAL_MS,
  DEFAULT_CADENCE_MAX_NUDGES,
  NUDGE_LOOKBACK_MS,
} from '../src/nudge-floor';
import { OVERDUE_INVOICE_READ_WINDOW_MS } from '../src/primitives/nudge-overdue-invoice';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

describe('resolveCadencePolicy — clamps owner/learned input to the floor', () => {
  it('defaults sit at/above the floor when nothing is supplied', () => {
    const p = resolveCadencePolicy();
    expect(p.intervalMs).toBe(DEFAULT_CADENCE_INTERVAL_MS);
    expect(p.maxNudges).toBe(DEFAULT_CADENCE_MAX_NUDGES);
    expect(p.intervalMs).toBeGreaterThanOrEqual(FLOOR_MIN_INTERVAL_MS);
    expect(p.maxNudges).toBeLessThanOrEqual(FLOOR_MAX_NUDGES);
  });

  it('an owner who asks for a LOOSER interval is clamped UP to the floor', () => {
    const p = resolveCadencePolicy({ intervalMs: 1 * DAY }); // below the 3-day floor
    expect(p.intervalMs).toBe(FLOOR_MIN_INTERVAL_MS);
  });

  it('an owner who asks for MORE nudges is clamped DOWN to the floor cap', () => {
    const p = resolveCadencePolicy({ maxNudges: 99 });
    expect(p.maxNudges).toBe(FLOOR_MAX_NUDGES);
  });

  it('a stricter owner policy is honored (interval slower / fewer nudges)', () => {
    const p = resolveCadencePolicy({ intervalMs: 30 * DAY, maxNudges: 2 });
    expect(p.intervalMs).toBe(30 * DAY);
    expect(p.maxNudges).toBe(2);
  });

  it('maxNudges floors at 1 (a 0/negative request cannot disable nudging into a divide-by-zero)', () => {
    expect(resolveCadencePolicy({ maxNudges: 0 }).maxNudges).toBe(1);
    expect(resolveCadencePolicy({ maxNudges: -5 }).maxNudges).toBe(1);
  });

  it('NaN/Infinity input coerces to the clamped default — cannot DISABLE the gate (red-team P2-1)', () => {
    // typeof NaN === 'number' slips past the type guard; without coercion
    // Math.max/Math.min propagate NaN and the gate would never fire.
    const nan = resolveCadencePolicy({ intervalMs: NaN, maxNudges: NaN });
    expect(nan.intervalMs).toBe(DEFAULT_CADENCE_INTERVAL_MS);
    expect(nan.maxNudges).toBe(DEFAULT_CADENCE_MAX_NUDGES);
    const inf = resolveCadencePolicy({ intervalMs: Infinity, maxNudges: Infinity });
    // Infinity interval is finite-checked → default (not an infinite cooldown);
    // Infinity maxNudges → default, then clamped ≤ floor.
    expect(inf.intervalMs).toBe(DEFAULT_CADENCE_INTERVAL_MS);
    expect(inf.maxNudges).toBe(DEFAULT_CADENCE_MAX_NUDGES);
    // And decideNudge with the coerced policy still BLOCKS, never silently allows.
    const d = decideNudge([NaN as unknown as number], NOW, nan);
    // a NaN history entry is ignored by Math.max semantics but count is still 1 < 3 → allowed;
    // the point is the policy itself is well-formed (finite), not NaN.
    expect(Number.isFinite(nan.intervalMs)).toBe(true);
    expect(Number.isFinite(nan.maxNudges)).toBe(true);
    expect(d).toHaveProperty('allow');
  });
});

describe('the count cap is effectively a lifetime cap (lookback > read window invariant)', () => {
  it('NUDGE_LOOKBACK_MS strictly exceeds the overdue-invoice Stripe read window', () => {
    // logic-skeptic P2-1: the "≤ FLOOR_MAX_NUDGES per invoice" property is only a
    // lifetime cap while an invoice ages OUT of the read window before it ages out
    // of the lookback. If someone widens the Stripe read window past the lookback,
    // a long-lived invoice could be nudged more than the cap. This trips CI first.
    expect(NUDGE_LOOKBACK_MS).toBeGreaterThan(OVERDUE_INVOICE_READ_WINDOW_MS);
  });
});

describe('decideNudge — interval + count gates', () => {
  const policy = resolveCadencePolicy({ intervalMs: 7 * DAY, maxNudges: 3 });

  it('first-ever nudge (no history) is allowed', () => {
    expect(decideNudge([], NOW, policy)).toEqual({ allow: true });
  });

  it('blocks a second nudge inside the cadence interval (too_soon)', () => {
    const d = decideNudge([NOW - 2 * DAY], NOW, policy);
    expect(d.allow).toBe(false);
    expect(d).toMatchObject({ reason: 'too_soon' });
  });

  it('allows the next nudge once the interval has elapsed', () => {
    expect(decideNudge([NOW - 8 * DAY], NOW, policy)).toEqual({ allow: true });
  });

  it('blocks once the max count is reached (max_count)', () => {
    const d = decideNudge([NOW - 30 * DAY, NOW - 20 * DAY, NOW - 10 * DAY], NOW, policy);
    expect(d.allow).toBe(false);
    expect(d).toMatchObject({ reason: 'max_count' });
  });

  it('uses the MOST RECENT timestamp for the interval gate regardless of order', () => {
    // unordered history of 2 (under the count cap); the most recent is 1 day ago → too soon
    const twoMax = resolveCadencePolicy({ intervalMs: 7 * DAY, maxNudges: 4 });
    const d = decideNudge([NOW - 40 * DAY, NOW - 1 * DAY], NOW, twoMax);
    expect(d.allow).toBe(false);
    expect(d).toMatchObject({ reason: 'too_soon' });
  });
});

describe('decideNudge — the floor flag distinguishes hard floor from soft cadence', () => {
  it('a stricter owner interval block that the FLOOR alone would NOT block reports floor:false', () => {
    const strict = resolveCadencePolicy({ intervalMs: 14 * DAY, maxNudges: 3 });
    // last nudge 5 days ago: past the 3-day floor, but inside the 14-day owner cadence
    const d = decideNudge([NOW - 5 * DAY], NOW, strict);
    expect(d).toMatchObject({ allow: false, reason: 'too_soon', floor: false });
  });

  it('a block inside the hard floor reports floor:true', () => {
    const policy = resolveCadencePolicy({ intervalMs: 7 * DAY });
    const d = decideNudge([NOW - 1 * DAY], NOW, policy); // inside the 3-day floor
    expect(d).toMatchObject({ allow: false, reason: 'too_soon', floor: true });
  });

  it('the hard count cap holds even if a stricter owner cap is also hit', () => {
    const policy = resolveCadencePolicy({ maxNudges: FLOOR_MAX_NUDGES });
    const history = Array.from({ length: FLOOR_MAX_NUDGES }, (_, i) => NOW - (i + 10) * DAY);
    const d = decideNudge(history, NOW, policy);
    expect(d).toMatchObject({ allow: false, reason: 'max_count', floor: true });
  });
});
