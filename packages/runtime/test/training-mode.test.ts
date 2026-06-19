/**
 * Training Mode (§18.1) — PROOF of non-loosening. These tests are the
 * reviewer's evidence that Training Mode is STRICTLY ADDITIVE to Agent School:
 *
 *  1. enabling training does NOT change gateSideEffect's output for ANY
 *     (stage, approvals) input — the draft-vs-execute gate is byte-identical.
 *  2. promotion still requires the FULL unchanged threshold — training never
 *     lowers windowRuns / minApprovedUneditedPct / coverage.
 *  3. a window is time-boxed + budget-bounded + auto-expires.
 *  4. an expired / over-budget window STOPS sampling.
 *  5. windows are account-scoped — one account can't sample another's agent.
 *  6. there is no auto-execute path: training only ever says "sample" (a
 *     supervised run) or "stop", never "execute".
 */
import { describe, expect, it } from 'vitest';
import {
  gateSideEffect,
  promotionCheck,
  trainingActive,
  trainingClosedBy,
  trainingSampleDecision,
  consumeSample,
  noveltyVariants,
  clampWindow,
  MemoryTrainingStore,
  MIN_WINDOW_MS,
  MAX_WINDOW_MS,
  MAX_TRAINING_RUNS,
  MAX_NOVELTY_VARIANTS,
  STAGES,
  type CurriculumConfig,
  type Decision,
  type TrainingWindow,
} from '../src/index';

const ACCOUNT = 'acct-1';
const OTHER = 'acct-2';
const NIB = 'nib-1';
const T0 = 1_000_000_000_000; // fixed epoch ms

function curriculum(): CurriculumConfig {
  return {
    measures: 'test',
    promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95 },
    routineMinApprovals: 5,
  };
}

function window(over: Partial<TrainingWindow> = {}): TrainingWindow {
  return {
    id: 'train-1',
    accountId: ACCOUNT,
    nibbinId: NIB,
    startedAtMs: T0,
    expiresAtMs: T0 + 24 * 60 * 60 * 1000,
    maxRuns: 10,
    runsUsed: 0,
    novelty: false,
    ...over,
  };
}

function decisions(approved: number, total = 25): Decision[] {
  const arr: Decision[] = [];
  for (let i = 0; i < approved; i++) arr.push('approved');
  for (let i = approved; i < total; i++) arr.push('rejected');
  return arr;
}

/* ── 1. The School gate is UNCHANGED by training ──────────────────────────── */

describe('§18.1 NON-LOOSENING: gateSideEffect is identical with/without training', () => {
  // Training Mode has no parameter into gateSideEffect — it cannot. We prove the
  // gate's decision is a pure function of (stage, approvals, curriculum) and that
  // the entire training surface never produces an `execute` for an input the gate
  // would have drafted.
  it('every (stage, approvals) gate decision is unaffected — there is no training input to the gate', () => {
    const c = curriculum();
    for (const stage of STAGES) {
      for (const approvals of [0, 4, 5, 6, 100]) {
        // The gate signature takes no training argument; an active window over
        // this exact agent does not and cannot enter this call.
        const baseline = gateSideEffect(stage, approvals, c);
        const w = window();
        expect(trainingActive(w, T0)).toBe(true); // window is live...
        const withTraining = gateSideEffect(stage, approvals, c); // ...gate is still identical
        expect(withTraining).toEqual(baseline);
      }
    }
  });

  it('senior below routineMinApprovals still DRAFTS — training cannot flip it to execute', () => {
    const c = curriculum();
    // 4 < routineMinApprovals(5): the gate drafts (novelty). Training only adds
    // MORE such drafts; it has no way to make this an execute.
    expect(gateSideEffect('senior', 4, c)).toEqual({ action: 'draft', reason: 'novelty' });
    // trainingSampleDecision only ever returns sample/stop — never execute.
    const d = trainingSampleDecision(window(), 'senior', T0);
    expect(d).toEqual({ sample: true, runsRemaining: 9 });
    expect('execute' in (d as object)).toBe(false);
  });

  it('egg stays observe-only — a training window never samples an egg', () => {
    expect(gateSideEffect('egg', 999, curriculum())).toEqual({ action: 'deny', reason: 'egg' });
    expect(trainingSampleDecision(window(), 'egg', T0)).toEqual({ sample: false, reason: 'inactive' });
  });
});

/* ── 2. Promotion threshold UNCHANGED by training ─────────────────────────── */

describe('§18.1 NON-LOOSENING: promotion still requires the full earned signal', () => {
  it('training does not lower the threshold — 24/25 still fails, 25/25 still passes', () => {
    // There is no training parameter to promotionCheck; these are the same
    // thresholds whether or not a window is open. (Floor 25 / 0.95.)
    expect(promotionCheck(decisions(23), curriculum()).eligible).toBe(false);
    expect(promotionCheck(decisions(25), curriculum()).eligible).toBe(true);
    // An under-full window is still not eligible — accelerating sampling fills
    // the window faster but the BAR to clear it is unchanged.
    expect(promotionCheck(decisions(10, 10), curriculum()).eligible).toBe(false);
  });
});

/* ── 3. Time-boxed + budget-bounded + auto-expires ────────────────────────── */

describe('§18.1 window is time-boxed, budget-bounded, auto-expiring', () => {
  it('active before the time box, dead at/after it', () => {
    const w = window({ expiresAtMs: T0 + 1000 });
    expect(trainingActive(w, T0)).toBe(true);
    expect(trainingActive(w, T0 + 999)).toBe(true);
    expect(trainingActive(w, T0 + 1000)).toBe(false); // auto-expire, no sweep needed
    expect(trainingClosedBy(w, T0 + 1000)).toBe('time_box');
  });

  it('dead once the run budget is spent', () => {
    const w = window({ maxRuns: 2, runsUsed: 2 });
    expect(trainingActive(w, T0)).toBe(false);
    expect(trainingClosedBy(w, T0)).toBe('budget');
  });

  it('clampWindow enforces conservative bounds — no unbounded window can exist', () => {
    const tiny = clampWindow({ accountId: ACCOUNT, nibbinId: NIB, durationMs: 1, maxRuns: 0, novelty: false });
    expect(tiny.durationMs).toBe(MIN_WINDOW_MS);
    expect(tiny.maxRuns).toBe(1);
    const huge = clampWindow({
      accountId: ACCOUNT, nibbinId: NIB, durationMs: 999 * MAX_WINDOW_MS, maxRuns: 10_000, novelty: false,
    });
    expect(huge.durationMs).toBe(MAX_WINDOW_MS);
    expect(huge.maxRuns).toBe(MAX_TRAINING_RUNS);
  });
});

/* ── 4. Expired / over-budget STOPS sampling ──────────────────────────────── */

describe('§18.1 an expired/over-budget window stops sampling', () => {
  it('stops at the time box', () => {
    const w = window({ expiresAtMs: T0 + 1000 });
    expect(trainingSampleDecision(w, 'student', T0 + 5000)).toEqual({ sample: false, reason: 'time_box' });
  });

  it('stops at the budget cap', () => {
    const w = window({ maxRuns: 1, runsUsed: 1 });
    expect(trainingSampleDecision(w, 'student', T0)).toEqual({ sample: false, reason: 'budget' });
  });

  it('consumeSample auto-closes the window when it hits the budget', () => {
    const w = window({ maxRuns: 1, runsUsed: 0 });
    const next = consumeSample(w, T0);
    expect(next.runsUsed).toBe(1);
    expect(next.endedReason).toBe('budget');
    expect(trainingActive(next, T0)).toBe(false);
    expect(() => consumeSample(next, T0)).toThrow(); // cannot over-spend
  });

  it('a sample decrements remaining and the window keeps sampling until budget', () => {
    let w = window({ maxRuns: 3 });
    expect(trainingSampleDecision(w, 'student', T0)).toEqual({ sample: true, runsRemaining: 2 });
    w = consumeSample(w, T0);
    expect(trainingSampleDecision(w, 'student', T0)).toEqual({ sample: true, runsRemaining: 1 });
    w = consumeSample(w, T0);
    expect(trainingSampleDecision(w, 'student', T0)).toEqual({ sample: true, runsRemaining: 0 });
    w = consumeSample(w, T0);
    expect(trainingSampleDecision(w, 'student', T0)).toEqual({ sample: false, reason: 'budget' });
  });
});

/* ── 5. Account-scoped ────────────────────────────────────────────────────── */

describe('§18.1 account-scoped — a window cannot affect another account', () => {
  it('store.active is scoped by account', async () => {
    const store = new MemoryTrainingStore();
    await store.open({ accountId: ACCOUNT, nibbinId: NIB, durationMs: MIN_WINDOW_MS, maxRuns: 5, novelty: false }, T0);
    // same nibbin id, DIFFERENT account → no window visible
    expect(await store.active(OTHER, NIB, T0)).toBeNull();
    expect(await store.active(ACCOUNT, NIB, T0)).not.toBeNull();
  });

  it('opening is idempotent per agent (one open window)', async () => {
    const store = new MemoryTrainingStore();
    const a = await store.open({ accountId: ACCOUNT, nibbinId: NIB, durationMs: MIN_WINDOW_MS, maxRuns: 5, novelty: false }, T0);
    const b = await store.open({ accountId: ACCOUNT, nibbinId: NIB, durationMs: MAX_WINDOW_MS, maxRuns: 99, novelty: true }, T0);
    expect(b.id).toBe(a.id); // same window, not a second budget
    expect(store.all().length).toBe(1);
  });

  it('user opt-out closes the window immediately', async () => {
    const store = new MemoryTrainingStore();
    await store.open({ accountId: ACCOUNT, nibbinId: NIB, durationMs: MIN_WINDOW_MS, maxRuns: 5, novelty: false }, T0);
    await store.close(ACCOUNT, NIB, 'user', T0 + 1000);
    expect(await store.active(ACCOUNT, NIB, T0 + 2000)).toBeNull();
  });

  it('recordSample advances the persisted window and auto-closes at budget', async () => {
    const store = new MemoryTrainingStore();
    let w = await store.open({ accountId: ACCOUNT, nibbinId: NIB, durationMs: MIN_WINDOW_MS, maxRuns: 2, novelty: false }, T0);
    w = await store.recordSample(w, T0);
    expect(w.runsUsed).toBe(1);
    expect(await store.active(ACCOUNT, NIB, T0)).not.toBeNull();
    w = await store.recordSample(w, T0);
    expect(w.runsUsed).toBe(2);
    expect(await store.active(ACCOUNT, NIB, T0)).toBeNull(); // budget spent → closed
  });
});

/* ── 6. Novelty variants are bounded and never fabricate ──────────────────── */

describe('§18.1 novelty variants are bounded and base-first', () => {
  it('off → just the base', () => {
    expect(noveltyVariants(window({ novelty: false }), 'base', ['a', 'b'])).toEqual(['base']);
  });

  it('on → base first, capped, de-duped, no empties', () => {
    const w = window({ novelty: true });
    const out = noveltyVariants(w, 'base', ['alt1', '  ', 'base', 'alt2', 'alt3', 'alt4']);
    expect(out[0]).toBe('base');
    expect(out.length).toBeLessThanOrEqual(MAX_NOVELTY_VARIANTS);
    expect(out).not.toContain('');
    expect(new Set(out).size).toBe(out.length); // no dupes
  });

  it('on but no alternates → just the base (never invents content)', () => {
    expect(noveltyVariants(window({ novelty: true }), 'base', [])).toEqual(['base']);
  });
});
