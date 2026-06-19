import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { NibbinRef, RunOutcome, RunTrigger, TrainingWindow } from '@nibbin/runtime';
import {
  GET,
  runScheduleTick,
  MAX_LAUNCHES_PER_TICK,
  DUE_SCAN_LIMIT,
  SEED_DISCOVERY_LIMIT,
  type ScheduleTickDeps,
  type ScheduleStateRow,
  type DueOccurrence,
} from './route';

// The GET handler wires Supabase-backed deps; stub the seams so importing +
// invoking the route never reaches a live DB. (runScheduleTick is tested with
// pure fakes below, independent of these mocks.)
vi.mock('../../../../lib/supabase/service', () => ({
  serviceClient: vi.fn(() => ({ from: vi.fn(), rpc: vi.fn() })),
}));
vi.mock('../../../../lib/runtime/engine', () => ({
  dueScheduleOccurrences: vi.fn().mockResolvedValue([]),
  seedCandidateNibbins: vi.fn().mockResolvedValue([]),
  triggerNibbinRun: vi.fn().mockResolvedValue({ kind: 'completed', runId: 'r' }),
}));
vi.mock('../../../../lib/runtime/stores', () => ({
  SupabaseTrainingStore: vi.fn(function () {
    return { active: vi.fn().mockResolvedValue(null), recordSample: vi.fn() };
  }),
}));

function makeReq(authorization?: string): NextRequest {
  return new NextRequest('http://localhost/api/cron/nibbin-schedule', {
    method: 'GET',
    headers: authorization ? { authorization } : {},
  });
}

/* ── fixtures ──────────────────────────────────────────────────────────────── */

function nibbin(over: Partial<NibbinRef> & { id: string; schedule?: string | null }): NibbinRef {
  const schedule = over.schedule === null ? undefined : (over.schedule ?? 'daily.morning');
  return {
    id: over.id,
    accountId: over.accountId ?? `acct-${over.id}`,
    name: over.name ?? over.id,
    stage: over.stage ?? 'student',
    status: over.status ?? 'active',
    spec: over.spec ?? ({
      templateKey: 't',
      version: 1,
      displayName: 'x',
      toolsAllowlist: [],
      requiredConnectors: [],
      triggers: schedule ? [{ kind: 'schedule', schedule }] : [],
      curriculum: {} as never,
      creditProfile: {} as never,
    } as NibbinRef['spec']),
  };
}

// Anchored to the tick's fixed NOW (defined below), not wall-clock, so the
// window is unambiguously open as of the tick instant.
function openWindow(over: Partial<TrainingWindow> & { nibbinId: string; accountId: string }): TrainingWindow {
  const now = NOW.getTime();
  return {
    id: `w-${over.nibbinId}`,
    startedAtMs: now - 1000,
    expiresAtMs: now + 60 * 60 * 1000,
    maxRuns: 10,
    runsUsed: 0,
    novelty: false,
    ...over,
  };
}

/**
 * A fake state store mirroring `nibbin_schedule_state` + the conditional claim,
 * plus a nibbin registry so it can serve the DUE-FIRST scan (state rows joined
 * to their nibbin, oldest-due first) and the seed-candidate scan (registered
 * nibbins lacking a state row). `register(nibbins)` makes nibbins known.
 */
function fakeStateStore(initial: ScheduleStateRow[], nibbins: NibbinRef[] = []) {
  const rows = new Map<string, ScheduleStateRow>(initial.map((r) => [`${r.nibbinId}|${r.scheduleKey}`, { ...r }]));
  const registry = new Map<string, NibbinRef>(nibbins.map((n) => [n.id, n]));
  const store = {
    rows,
    register(more: NibbinRef[]) {
      for (const n of more) registry.set(n.id, n);
      return store;
    },
    // DUE-FIRST: state rows with next_run_at <= now, oldest-due first, joined to
    // their (registered, active) nibbin, bounded by limit.
    loadDueOccurrences: async (now: Date, limit: number): Promise<DueOccurrence[]> =>
      [...rows.values()]
        .filter((r) => r.nextRunAt.getTime() <= now.getTime())
        .sort((a, b) => a.nextRunAt.getTime() - b.nextRunAt.getTime())
        .map((r) => ({ nibbin: registry.get(r.nibbinId), scheduleKey: r.scheduleKey }))
        .filter((d): d is DueOccurrence => !!d.nibbin && d.nibbin.status === 'active')
        .slice(0, limit),
    // SEED candidates: registered schedule-carrying nibbins with NO state row.
    loadSeedCandidates: async (limit: number): Promise<NibbinRef[]> =>
      [...registry.values()]
        .filter((n) => n.status === 'active' && n.spec.triggers.some((t) => t.kind === 'schedule'))
        .filter((n) => ![...rows.values()].some((r) => r.nibbinId === n.id))
        .slice(0, limit),
    seed: async (n: NibbinRef, key: string, next: Date) => {
      const k = `${n.id}|${key}`;
      if (!rows.has(k)) rows.set(k, { nibbinId: n.id, scheduleKey: key, nextRunAt: next });
    },
    // mirrors the SQL: update iff next_run_at <= now, advancing next_run_at; FOUND.
    claimAndAdvance: async (nibbinId: string, key: string, now: Date, next: Date) => {
      const k = `${nibbinId}|${key}`;
      const row = rows.get(k);
      if (!row || row.nextRunAt.getTime() > now.getTime()) return false;
      rows.set(k, { ...row, nextRunAt: next });
      return true;
    },
  };
  return store;
}

function baseDeps(over: Partial<ScheduleTickDeps>, store = fakeStateStore([])): ScheduleTickDeps {
  return {
    loadDueOccurrences: store.loadDueOccurrences,
    loadSeedCandidates: store.loadSeedCandidates,
    resolveTz: async () => 'UTC',
    seed: store.seed,
    claimAndAdvance: store.claimAndAdvance,
    triggerRun: async (): Promise<RunOutcome> => ({ kind: 'completed', runId: 'r' }),
    trainingActiveWindow: async () => null,
    recordSample: async (w) => w,
    now: () => new Date('2026-06-19T12:00:00Z'),
    ...over,
  };
}

const NOW = new Date('2026-06-19T12:00:00Z');
const PAST = new Date('2026-06-19T08:00:00Z'); // due
const FUTURE = new Date('2026-06-20T08:00:00Z'); // not due

/* ── base cadence ───────────────────────────────────────────────────────────── */

describe('runScheduleTick — base cadence', () => {
  it('a DUE nibbin fires exactly once and advances next_run_at', async () => {
    const store = fakeStateStore(
      [{ nibbinId: 'n1', scheduleKey: 'daily.morning', nextRunAt: PAST }],
      [nibbin({ id: 'n1' })],
    );
    const triggers: RunTrigger[] = [];
    const deps = baseDeps(
      { triggerRun: async (_id, t) => { triggers.push(t); return { kind: 'completed', runId: 'r' }; } },
      store,
    );
    const res = await runScheduleTick(deps);
    expect(res.fired).toBe(1);
    expect(triggers).toEqual([{ kind: 'schedule', key: 'daily.morning' }]);
    // advanced into the future → not due any more
    expect(store.rows.get('n1|daily.morning')!.nextRunAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('a NOT-DUE nibbin does not fire (its future-dated row is never returned by the due scan)', async () => {
    const store = fakeStateStore(
      [{ nibbinId: 'n1', scheduleKey: 'daily.morning', nextRunAt: FUTURE }],
      [nibbin({ id: 'n1' })],
    );
    const trigger = vi.fn(async (): Promise<RunOutcome> => ({ kind: 'completed', runId: 'r' }));
    const deps = baseDeps({ triggerRun: trigger }, store);
    const res = await runScheduleTick(deps);
    expect(res.fired).toBe(0);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('a freshly-discovered nibbin (no state row) seeds a future occurrence and does NOT fire this tick', async () => {
    const store = fakeStateStore([], [nibbin({ id: 'n1' })]);
    const trigger = vi.fn(async (): Promise<RunOutcome> => ({ kind: 'completed', runId: 'r' }));
    const deps = baseDeps({ triggerRun: trigger }, store);
    const res = await runScheduleTick(deps);
    expect(res.fired).toBe(0);
    expect(trigger).not.toHaveBeenCalled();
    const seeded = store.rows.get('n1|daily.morning')!;
    expect(seeded.nextRunAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("an egg's not_started outcome is handled cleanly (counted as a fire, not an error)", async () => {
    const store = fakeStateStore(
      [{ nibbinId: 'n1', scheduleKey: 'daily.morning', nextRunAt: PAST }],
      [nibbin({ id: 'n1', stage: 'egg' })],
    );
    const deps = baseDeps(
      { triggerRun: async (): Promise<RunOutcome> => ({ kind: 'not_started', why: 'egg' }) },
      store,
    );
    const res = await runScheduleTick(deps);
    expect(res.errors).toEqual([]);
    expect(res.fired).toBe(1); // the launch happened; the runner refused the egg — a clean no-op
  });

  it('only nibbins with a recognized schedule trigger are seeded', async () => {
    // n2 carries no schedule trigger → not a seed candidate, never seeded.
    const store = fakeStateStore([], [
      nibbin({ id: 'n1', schedule: 'daily.morning' }),
      nibbin({ id: 'n2', schedule: null }),
    ]);
    const deps = baseDeps({}, store);
    const res = await runScheduleTick(deps);
    expect(res.scanned).toBe(1); // only n1 is a candidate
    expect(store.rows.has('n1|daily.morning')).toBe(true);
  });

  it('a claim error for one nibbin does NOT abort the batch and does NOT fire it', async () => {
    const store = fakeStateStore(
      [
        { nibbinId: 'n1', scheduleKey: 'daily.morning', nextRunAt: PAST },
        { nibbinId: 'n2', scheduleKey: 'daily.morning', nextRunAt: PAST },
      ],
      [nibbin({ id: 'n1' }), nibbin({ id: 'n2' })],
    );
    const fired: string[] = [];
    const deps = baseDeps(
      {
        claimAndAdvance: async (id, key, now, next) => {
          if (id === 'n1') throw new Error('boom');
          return store.claimAndAdvance(id, key, now, next);
        },
        triggerRun: async (id) => { fired.push(id); return { kind: 'completed', runId: 'r' }; },
      },
      store,
    );
    const res = await runScheduleTick(deps);
    expect(fired).toEqual(['n2']); // n1 errored, never fired
    expect(res.fired).toBe(1);
    expect(res.errors.some((e) => e.includes('n1'))).toBe(true);
  });
});

/* ── due-first fairness + cap surfacing (FIX 2) ─────────────────────────────── */

describe('runScheduleTick — due-first fairness + cap surfacing', () => {
  it('claims oldest-due first (the due scan is ordered, so no nibbin is starved)', async () => {
    const older = new Date('2026-06-19T07:00:00Z');
    const newer = new Date('2026-06-19T09:00:00Z');
    const store = fakeStateStore(
      [
        { nibbinId: 'nNew', scheduleKey: 'daily.morning', nextRunAt: newer },
        { nibbinId: 'nOld', scheduleKey: 'daily.morning', nextRunAt: older },
      ],
      [nibbin({ id: 'nNew' }), nibbin({ id: 'nOld' })],
    );
    const fired: string[] = [];
    const deps = baseDeps(
      { triggerRun: async (id) => { fired.push(id); return { kind: 'completed', runId: 'r' }; } },
      store,
    );
    await runScheduleTick(deps);
    expect(fired).toEqual(['nOld', 'nNew']); // oldest-due claimed first
  });

  it('surfaces scanCapped when the due scan returns its full limit', async () => {
    const store = fakeStateStore([], []);
    // Return exactly DUE_SCAN_LIMIT due occurrences → more due work exists.
    const nibs = Array.from({ length: DUE_SCAN_LIMIT }, (_, i) => nibbin({ id: `d${i}` }));
    const due: DueOccurrence[] = nibs.map((n) => ({ nibbin: n, scheduleKey: 'daily.morning' }));
    const deps = baseDeps(
      {
        loadDueOccurrences: async (_now, limit) => due.slice(0, limit),
        claimAndAdvance: async () => false, // don't fire (cap test is about scanCapped, not launches)
      },
      store,
    );
    const res = await runScheduleTick(deps);
    expect(res.scanCapped).toBe(true);
  });

  it('surfaces seedCapped when the seed-discovery scan returns its full limit', async () => {
    const candidates = Array.from({ length: SEED_DISCOVERY_LIMIT }, (_, i) => nibbin({ id: `s${i}` }));
    const deps = baseDeps({
      loadSeedCandidates: async (limit) => candidates.slice(0, limit),
    });
    const res = await runScheduleTick(deps);
    expect(res.seedCapped).toBe(true);
  });
});

/* ── exactly-once ──────────────────────────────────────────────────────────── */

describe('claim exactly-once (fake mirrors the conditional update)', () => {
  it('a second claim for the same occurrence returns false; the run fires once', async () => {
    const store = fakeStateStore([{ nibbinId: 'n1', scheduleKey: 'daily.morning', nextRunAt: PAST }]);
    const first = await store.claimAndAdvance('n1', 'daily.morning', NOW, FUTURE);
    const second = await store.claimAndAdvance('n1', 'daily.morning', NOW, FUTURE);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('two ticks over the same due row fire it only once total', async () => {
    const store = fakeStateStore(
      [{ nibbinId: 'n1', scheduleKey: 'daily.morning', nextRunAt: PAST }],
      [nibbin({ id: 'n1' })],
    );
    const fired: string[] = [];
    const mk = () => baseDeps(
      { triggerRun: async (id) => { fired.push(id); return { kind: 'completed', runId: 'r' }; } },
      store,
    );
    await runScheduleTick(mk());
    await runScheduleTick(mk());
    expect(fired).toEqual(['n1']);
  });
});

/* ── training sampling ─────────────────────────────────────────────────────── */

describe('runScheduleTick — training sampling', () => {
  it('an open window whose recordSample CONSUMES a unit fires one extra sampled run', async () => {
    const win = openWindow({ nibbinId: 'n1', accountId: 'acct-n1' });
    const triggers: RunTrigger[] = [];
    // n1 is a seed candidate (no state row) so base does not fire — only sampled.
    const store = fakeStateStore([], [nibbin({ id: 'n1' })]);
    const deps = baseDeps({
      trainingActiveWindow: async () => win,
      recordSample: async (w) => ({ ...w, runsUsed: w.runsUsed + 1 }), // consumed
      triggerRun: async (_id, t) => { triggers.push(t); return { kind: 'completed', runId: 'r' }; },
    }, store);
    const res = await runScheduleTick(deps);
    expect(res.sampled).toBe(1);
    expect(triggers).toContainEqual({ kind: 'schedule', key: 'training.sample' });
  });

  it('a closed/exhausted window (recordSample consumes nothing) fires no sampled run', async () => {
    const win = openWindow({ nibbinId: 'n1', accountId: 'acct-n1', runsUsed: 2 });
    const trigger = vi.fn(async (): Promise<RunOutcome> => ({ kind: 'completed', runId: 'r' }));
    const store = fakeStateStore([], [nibbin({ id: 'n1' })]);
    const deps = baseDeps({
      trainingActiveWindow: async () => win,
      // RPC returned NULL → store reflects a closed window with runsUsed unchanged.
      recordSample: async (w) => ({ ...w, endedAtMs: Date.now() }),
      triggerRun: trigger,
    }, store);
    const res = await runScheduleTick(deps);
    expect(res.sampled).toBe(0);
    // n1 still gets a base seed (no fire) but no sampled run.
    expect(trigger).not.toHaveBeenCalled();
  });

  it('no open window → no sampling, no recordSample call', async () => {
    const record = vi.fn();
    const store = fakeStateStore([], [nibbin({ id: 'n1' })]);
    const deps = baseDeps({
      trainingActiveWindow: async () => null,
      recordSample: record,
    }, store);
    const res = await runScheduleTick(deps);
    expect(res.sampled).toBe(0);
    expect(record).not.toHaveBeenCalled();
  });

  it('an egg window pre-check short-circuits (never spends a budget unit)', async () => {
    const win = openWindow({ nibbinId: 'n1', accountId: 'acct-n1' });
    const record = vi.fn(async (w: TrainingWindow) => w);
    const store = fakeStateStore([], [nibbin({ id: 'n1', stage: 'egg' })]);
    const deps = baseDeps({
      trainingActiveWindow: async () => win,
      recordSample: record,
    }, store);
    const res = await runScheduleTick(deps);
    expect(res.sampled).toBe(0);
    expect(record).not.toHaveBeenCalled(); // trainingSampleDecision said {sample:false}
  });

  it('FIX 3: a nibbin that base-fired this tick is NOT also training-sampled (no wasted unit)', async () => {
    // n1 is DUE (base fires) AND has an open window with budget. The base fire
    // must claim the slot; the training pass must SKIP n1 so no unit is consumed.
    const win = openWindow({ nibbinId: 'n1', accountId: 'acct-n1' });
    const store = fakeStateStore(
      [{ nibbinId: 'n1', scheduleKey: 'daily.morning', nextRunAt: PAST }],
      [nibbin({ id: 'n1' })],
    );
    const record = vi.fn(async (w: TrainingWindow) => ({ ...w, runsUsed: w.runsUsed + 1 }));
    const triggers: RunTrigger[] = [];
    const deps = baseDeps({
      trainingActiveWindow: async () => win,
      recordSample: record,
      triggerRun: async (_id, t) => { triggers.push(t); return { kind: 'completed', runId: 'r' }; },
    }, store);
    const res = await runScheduleTick(deps);
    expect(res.fired).toBe(1);
    expect(res.sampled).toBe(0); // skipped — base-fired this tick
    expect(record).not.toHaveBeenCalled(); // budget unit NOT consumed
    expect(triggers).toEqual([{ kind: 'schedule', key: 'daily.morning' }]);
  });
});

/* ── per-tick cap ──────────────────────────────────────────────────────────── */

describe('runScheduleTick — per-tick launch cap', () => {
  it('defers base-cadence launches beyond MAX_LAUNCHES_PER_TICK (deferred rows stay due)', async () => {
    const n = MAX_LAUNCHES_PER_TICK + 5;
    const nibs = Array.from({ length: n }, (_, i) => nibbin({ id: `n${i}` }));
    const store = fakeStateStore(
      nibs.map((b) => ({ nibbinId: b.id, scheduleKey: 'daily.morning', nextRunAt: PAST })),
      nibs,
    );
    const deps = baseDeps({}, store);
    const res = await runScheduleTick(deps);
    expect(res.fired).toBe(MAX_LAUNCHES_PER_TICK);
    expect(res.deferred).toBe(5);
    expect(res.capped).toBe(true);
    // a deferred row was NOT claimed → still due (fires next tick)
    const stillDue = [...store.rows.values()].filter((r) => r.nextRunAt.getTime() <= NOW.getTime());
    expect(stillDue.length).toBe(5);
  });
});

/* ── auth (real GET handler) ───────────────────────────────────────────────── */

describe('GET /api/cron/nibbin-schedule — auth', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'test-key';
    vi.clearAllMocks();
  });

  it('returns 401 with no authorization header', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('returns 401 with the wrong secret', async () => {
    const res = await GET(makeReq('Bearer wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('returns 200 with the { scanned, fired, sampled, deferred, errors } shape when authorized', async () => {
    const res = await GET(makeReq('Bearer test-cron-secret'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ scanned: 0, fired: 0, sampled: 0, deferred: 0, errors: [], scanCapped: false, seedCapped: false });
  });
});
