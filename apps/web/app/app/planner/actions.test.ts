/**
 * Planner server actions (Slice 3a, design §6): every action is account-scoped
 * and re-validates fail-closed BEFORE any model/effect. A tampered (off-surface)
 * client plan is refused with no run created; a foreign-account run id is refused.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PlanSpec } from '@nibbin/runtime';

// appSession + the run wiring are server-only; stub them so the action's
// validation guard is what we exercise.
const appSession = vi.fn(async () => ({ user: { id: 'user-1' }, accountId: 'acct-1' }));
vi.mock('../../../lib/auth/app-session', () => ({ appSession: () => appSession() }));

const create = vi.fn(async () => {});
const respondToRequest = vi.fn(async () => ({ kind: 'done', runId: 'r', artifact: {} }));
const buildPlannerRunDeps = vi.fn(async () => ({}));
vi.mock('../../../lib/planner/run', () => ({
  SupabasePlanRunStore: class {
    create = create;
  },
  respondToRequest: (...a: unknown[]) => respondToRequest(...(a as [])),
  buildPlannerRunDeps: () => buildPlannerRunDeps(),
}));

// the live connector list for the account
vi.mock('../../../lib/runtime/engine', () => ({
  activeConnections: vi.fn(async () => [{ provider: 'gmail', id: 'c1' }]),
}));
vi.mock('../../../lib/supabase/service', () => ({ serviceClient: () => ({}) }));

// runPlan should never be reached for a tampered plan
const runPlan = vi.fn(async () => ({ kind: 'done', runId: 'r', artifact: {} }));
vi.mock('@nibbin/runtime', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, runPlan: (...a: unknown[]) => runPlan(...(a as [])) };
});

import { startPlanRun, respondToPlanRun } from './actions';

function tamperedPlan(): PlanSpec {
  return {
    kind: 'plan',
    ephemeral: true,
    goal: 'do a thing',
    intendedSteps: ['x'],
    // email.send is a raw write cap — never a valid plan surface entry; and
    // stripe is not granted on this account.
    toolsAllowlist: ['email.send', 'payments.read', 'done'],
    requiredConnectors: ['gmail', 'stripe'],
    weightClass: 'frontier',
    ceilings: { maxSteps: 60, maxTokens: 8000, maxWallClockMs: 60_000, maxIterations: 12 },
  };
}

describe('startPlanRun — re-validates fail-closed', () => {
  it('refuses a tampered off-surface plan; no run created, runPlan never called', async () => {
    runPlan.mockClear();
    create.mockClear();
    const out = await startPlanRun(tamperedPlan());
    expect('error' in out).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(runPlan).not.toHaveBeenCalled();
  });
});

describe('respondToPlanRun — forwards to respondToRequest', () => {
  it('passes the runId/response through (account-scoped)', async () => {
    respondToRequest.mockClear();
    await respondToPlanRun('run-1', { requestId: 'req-1', value: 'hi' });
    expect(respondToRequest).toHaveBeenCalledTimes(1);
  });
});
