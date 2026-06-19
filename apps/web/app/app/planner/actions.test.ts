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
const countRunning = vi.fn(async () => 0);
const respondToRequest = vi.fn(async () => ({ kind: 'done', runId: 'r', artifact: {} }));
const buildPlannerRunDeps = vi.fn(async () => ({}));
vi.mock('../../../lib/planner/run', () => ({
  SupabasePlanRunStore: class {
    create = create;
    countRunning = countRunning;
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

/** A valid, runnable plan (gmail granted, read-only surface). FIX 3 tests post
 *  this with a crafted oversized maxTokens to prove validatePlanSpec rejects it
 *  and startPlanRun re-stamps the server ceilings. */
function craftedTokensPlan(): PlanSpec {
  return {
    kind: 'plan',
    ephemeral: true,
    goal: 'read the inbox',
    intendedSteps: ['read'],
    toolsAllowlist: ['email.read', 'done'],
    requiredConnectors: ['gmail'],
    weightClass: 'frontier',
    // a hostile ceiling: 1e9 tokens would neuter the token-budget kill
    ceilings: { maxSteps: 60, maxTokens: 1e9, maxWallClockMs: 60_000, maxIterations: 12 },
  };
}

describe('startPlanRun — re-validates fail-closed', () => {
  it('refuses a tampered off-surface plan; no run created, runPlan never called', async () => {
    appSession.mockResolvedValueOnce({ user: { id: 'user-1' }, accountId: 'acct-tamper' });
    runPlan.mockClear();
    create.mockClear();
    const out = await startPlanRun(tamperedPlan());
    expect('error' in out).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(runPlan).not.toHaveBeenCalled();
  });

  // FIX 3b: validatePlanSpec rejects a maxTokens:1e9 plan outright.
  it('validatePlanSpec rejects a crafted maxTokens:1e9 ceiling', async () => {
    const { validatePlanSpec } = await import('@nibbin/runtime');
    const problems = validatePlanSpec(craftedTokensPlan(), ['gmail'], { webSearchEnabled: false });
    expect(problems.some((p) => /maxTokens/i.test(p))).toBe(true);
  });

  // FIX 3a: startPlanRun re-stamps the server ceilings regardless of what was
  // posted — so it runs (the crafted 1e9 never reaches runPlan), with the
  // canonical maxTokens (8000), not 1e9.
  it('re-stamps the server ceilings; runs with the canonical maxTokens, not the posted one', async () => {
    appSession.mockResolvedValueOnce({ user: { id: 'user-1' }, accountId: 'acct-restamp' });
    runPlan.mockClear();
    create.mockClear();
    const out = await startPlanRun(craftedTokensPlan());
    expect('error' in out).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
    expect(runPlan).toHaveBeenCalledTimes(1);
    const ranPlan = (runPlan.mock.calls[0] as unknown[])[0] as PlanSpec;
    expect(ranPlan.ceilings.maxTokens).toBe(8000);
  });
});

describe('startPlanRun — concurrency cap (FIX 4)', () => {
  it('refuses the (N+1)th concurrent running start with a clean error', async () => {
    appSession.mockResolvedValueOnce({ user: { id: 'user-1' }, accountId: 'acct-cap' });
    runPlan.mockClear();
    create.mockClear();
    countRunning.mockResolvedValueOnce(3); // already at the cap
    const out = await startPlanRun(craftedTokensPlan());
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
