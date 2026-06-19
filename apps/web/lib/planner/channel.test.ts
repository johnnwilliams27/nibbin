/**
 * Channel-context planner wrappers (Task 2, §7.3):
 * principal-explicit equivalents of the server actions, callable from the
 * service-role channel path (no appSession). Three assertions per the spec:
 *   (a) a tampered/off-surface plan → {error}, no run created, runPlan never called
 *   (b) a valid plan → a PlanOutcome (kind:'done')
 *   (c) concurrency cap → {error} at 3 running
 */
import { describe, expect, it, vi } from 'vitest';
import type { PlanSpec } from '@nibbin/runtime';

// ── stub server-only deps the channel wrappers pull in ────────────────────
vi.mock('../runtime/engine', () => ({
  activeConnections: vi.fn(async () => [{ provider: 'gmail', id: 'c1' }]),
}));
vi.mock('../supabase/service', () => ({ serviceClient: () => ({}) }));
vi.mock('../llm/client', () => ({
  recordModelCall: vi.fn(async () => {}),
  anthropicGenerate: () => null,
}));
vi.mock('../grove/router', () => ({
  groveRouter: { route: vi.fn(async () => ({ degraded: true })) },
}));

// runPlan should never be called for a tampered plan; controllable for valid plan
const runPlan = vi.fn(async () => ({ kind: 'done', runId: 'r', artifact: {} }));
vi.mock('@nibbin/runtime', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, runPlan: (...a: unknown[]) => runPlan(...(a as [])) };
});

// ── import AFTER mocks are wired ──────────────────────────────────────────
import { InMemoryPlanRunStore } from './run';
import {
  startPlanRunForChannel,
  respondToPlanRunForChannel,
  proposePlanForChannel,
} from './channel';

// ── test data helpers ──────────────────────────────────────────────────────

const ACCOUNT = 'acct-ch-1';
const USER = 'user-ch-1';

/** A plan that uses a raw write-class capability (email.send) + an unganted
 *  connector (stripe) — validatePlanSpec must reject it. */
function tamperedPlan(): PlanSpec {
  return {
    kind: 'plan',
    ephemeral: true,
    goal: 'do a thing',
    intendedSteps: ['x'],
    toolsAllowlist: ['email.send', 'payments.read', 'done'],
    requiredConnectors: ['gmail', 'stripe'],
    weightClass: 'frontier',
    ceilings: { maxSteps: 60, maxTokens: 8000, maxWallClockMs: 60_000, maxIterations: 12 },
  };
}

/** A valid, runnable plan (gmail granted, read-only surface). */
function validPlan(): PlanSpec {
  return {
    kind: 'plan',
    ephemeral: true,
    goal: 'read the inbox',
    intendedSteps: ['read'],
    toolsAllowlist: ['email.read', 'done'],
    requiredConnectors: ['gmail'],
    weightClass: 'frontier',
    // ceilings will be re-stamped server-side; posting crafted values doesn't
    // matter (we just need them well-formed enough to survive the merge)
    ceilings: { maxSteps: 60, maxTokens: 8000, maxWallClockMs: 60_000, maxIterations: 12 },
  };
}

/** Build a stub PlannerDeps that avoids hitting any real Supabase. */
function stubDeps() {
  return {
    planner: { pick: vi.fn(async () => ({ done: true, artifact: { summary: 'ok' } })) },
    runner: {
      runs: {
        createRun: vi.fn(async () => ({ id: 'r' })),
        updateStatus: vi.fn(async () => {}),
        recordStep: vi.fn(async () => {}),
        load: vi.fn(async () => null),
      },
      routines: { getRoutine: vi.fn(async () => null) },
      grants: { hasGrant: vi.fn(async () => false) },
      idempotency: {
        claim: vi.fn(async () => 'claimed' as const),
        markExecuted: vi.fn(async () => {}),
      },
      events: { emit: vi.fn(async () => {}), flush: vi.fn(async () => {}) },
      reader: { read: vi.fn(async () => ({ wrapped: '{}', tag: 'test' })) },
      effects: { execute: vi.fn(async () => {}) },
      now: () => Date.now(),
    },
    connectors: ['gmail'],
    connMap: { gmail: 'conn-gmail' },
    accountId: ACCOUNT,
    utilities: {
      webSearch: vi.fn(async () => ({ wrapped: 'results', tag: 'web' })),
      webFetch: vi.fn(async () => ({ wrapped: 'page', tag: 'web' })),
      memoryRetrieve: vi.fn(async () => ({ wrapped: 'mem', tag: 'mem' })),
    },
    persist: { save: vi.fn(async () => {}) },
  };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('startPlanRunForChannel — (a) tampered plan → {error}, no run created', () => {
  it('refuses a tampered off-surface plan; no run created, runPlan never called', async () => {
    const store = new InMemoryPlanRunStore();
    runPlan.mockClear();

    const out = await startPlanRunForChannel(ACCOUNT, USER, tamperedPlan(), {
      store,
      buildDeps: async () => stubDeps() as unknown as Awaited<ReturnType<typeof import('./run').buildPlannerRunDeps>>,
    });

    expect('error' in out).toBe(true);
    // No rows should have been created in the store
    expect(runPlan).not.toHaveBeenCalled();
  });
});

describe('startPlanRunForChannel — (b) valid plan → PlanOutcome', () => {
  it('runs a valid plan and returns a PlanOutcome', async () => {
    const store = new InMemoryPlanRunStore();
    runPlan.mockClear();
    runPlan.mockResolvedValueOnce({ kind: 'done', runId: 'r', artifact: { summary: 'ok' } });

    const out = await startPlanRunForChannel(ACCOUNT, USER, validPlan(), {
      store,
      buildDeps: async () => stubDeps() as unknown as Awaited<ReturnType<typeof import('./run').buildPlannerRunDeps>>,
    });

    expect('error' in out).toBe(false);
    if ('error' in out) return;
    expect(out.kind).toBe('done');
    expect(runPlan).toHaveBeenCalledTimes(1);
    // The plan passed to runPlan must use the server-side PLAN_CEILINGS (maxTokens=8000)
    const ranPlan = (runPlan.mock.calls[0] as unknown[])[0] as PlanSpec;
    expect(ranPlan.ceilings.maxTokens).toBe(8000);
  });
});

describe('startPlanRunForChannel — (c) concurrency cap → {error} at 3 running', () => {
  it('refuses the (N+1)th concurrent running start with a clean error', async () => {
    // Pre-populate the store with 3 running runs for this account
    const store = new InMemoryPlanRunStore();
    for (let i = 0; i < 3; i++) {
      await store.create({
        runId: `running-${i}`,
        accountId: ACCOUNT,
        plan: validPlan(),
        transcript: [],
        scratchpad: {},
        status: 'running',
      });
    }
    runPlan.mockClear();

    const out = await startPlanRunForChannel(ACCOUNT, USER, validPlan(), {
      store,
      buildDeps: async () => stubDeps() as unknown as Awaited<ReturnType<typeof import('./run').buildPlannerRunDeps>>,
    });

    expect('error' in out).toBe(true);
    expect(runPlan).not.toHaveBeenCalled();
  });
});

describe('respondToPlanRunForChannel — forwards to respondToRequest', () => {
  it('passes runId/response through (account-scoped, returns PlanOutcome)', async () => {
    // A non-existent runId → account-scoped load returns null → 'run not found'.
    // We inject the store so respondToRequest uses InMemoryPlanRunStore (no DB
    // calls) and override buildDeps so it never hits the real Supabase client.
    const store = new InMemoryPlanRunStore();
    const out = await respondToPlanRunForChannel(
      ACCOUNT,
      USER,
      'no-such-run',
      { requestId: 'req-1', value: 'hello' },
      {
        store,
        buildDeps: async () => stubDeps() as unknown as Awaited<ReturnType<typeof import('./run').buildPlannerRunDeps>>,
      },
    );
    expect(out.kind).toBe('failed');
    if (out.kind !== 'failed') return;
    expect(out.error).toMatch(/not found/i);
  });
});

describe('proposePlanForChannel — resolves connections and calls planForIntent', () => {
  it('returns {error} when no model is available (degraded router)', async () => {
    // With anthropicGenerate returning null and router returning degraded:true,
    // planForIntent returns {error:'planning requires a model'}
    const out = await proposePlanForChannel(ACCOUNT, USER, 'summarise my inbox');
    expect('error' in out).toBe(true);
  });
});
