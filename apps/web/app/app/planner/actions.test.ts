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
// load is account-scoped: returns the run only when accountId matches. Tests
// override per-case via load.mockResolvedValueOnce.
const load = vi.fn(async (_runId: string, _accountId: string) => null as unknown);
vi.mock('../../../lib/planner/run', () => ({
  SupabasePlanRunStore: class {
    create = create;
    countRunning = countRunning;
    load = (...a: unknown[]) => load(...(a as [string, string]));
  },
  respondToRequest: (...a: unknown[]) => respondToRequest(...(a as [])),
  buildPlannerRunDeps: () => buildPlannerRunDeps(),
}));

// The crystallize web layer routes the soft-layer LLM; stub the model/router so
// the REAL crystallize runs the no-key deterministic path (steps still come from
// the trace via the real gate).
vi.mock('../../../lib/llm/client', () => ({
  recordModelCall: vi.fn(async () => {}),
  anthropicGenerate: () => null,
}));
vi.mock('../../../lib/grove/router', () => ({ groveRouter: { route: vi.fn(async () => ({ degraded: true })) } }));

// adoptComposedSpec is the adoption seam — capture the spec it is handed so a
// faithfulness test can assert the steps == the re-extracted ones.
const adoptComposedSpec = vi.fn(async (_acct: string, _user: string, spec: unknown) => ({
  nibbinId: 'nib-1',
  name: (spec as { displayName: string }).displayName,
  templateKey: null,
  stage: 'egg' as const,
  firstRun: null,
  missingConnectors: [] as string[],
  species: 'Wisp',
  palette: '#5B8DB0',
  accessory: 'none',
  marking: 'stripe',
  isFirstAdoption: true,
}));
vi.mock('../../../lib/runtime/adopt', () => ({
  adoptComposedSpec: (...a: unknown[]) => adoptComposedSpec(...(a as [string, string, unknown])),
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

import { startPlanRun, respondToPlanRun, proposeCrystal, adoptCrystal } from './actions';
import type { PlanRunState, PlanTurn } from '@nibbin/runtime';

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

/* ── Crystallization (Slice 4) ─────────────────────────────────────────────── */

const PLAN = {
  kind: 'plan' as const,
  ephemeral: true as const,
  goal: 'draft a follow-up for threads gone quiet',
  intendedSteps: ['watch the inbox', 'draft a nudge'],
  toolsAllowlist: ['nudge.overdue-email', 'done'],
  requiredConnectors: ['gmail'],
  weightClass: 'frontier' as const,
  ceilings: { maxSteps: 60, maxTokens: 8000, maxWallClockMs: 60_000, maxIterations: 12 },
};

function crystallizableRun(accountId = 'acct-1'): PlanRunState {
  const transcript: PlanTurn[] = [
    { idx: 0, pick: { tool: 'nudge.overdue-email', args: { staleDays: 3 } }, observation: 'drafted' },
    { idx: 1, pick: { done: true, artifact: {} } },
  ];
  return { runId: 'run-1', accountId, plan: PLAN, transcript, scratchpad: {}, status: 'done' };
}

describe('proposeCrystal — account-scoped, gate-authoritative', () => {
  it('returns {spec, preview} for a crystallizable done run', async () => {
    appSession.mockResolvedValueOnce({ user: { id: 'user-1' }, accountId: 'acct-1' });
    load.mockResolvedValueOnce(crystallizableRun());
    const out = await proposeCrystal('run-1');
    expect('refused' in out).toBe(false);
    if ('refused' in out) return;
    expect(out.spec.steps).toEqual([{ capability: 'nudge.overdue-email', inputs: { staleDays: 3 } }]);
  });

  it('refuses a foreign-account run id with not_found (never leaks)', async () => {
    appSession.mockResolvedValueOnce({ user: { id: 'user-1' }, accountId: 'acct-other' });
    load.mockResolvedValueOnce(null); // account-scoped load misses
    const out = await proposeCrystal('run-1');
    expect(out).toEqual({ refused: true, reason: 'not_found' });
  });
});

describe('adoptCrystal — re-derive + re-validate fail-closed from source', () => {
  it('re-derives the steps from the source plan_run (ignores any client payload)', async () => {
    appSession.mockResolvedValueOnce({ user: { id: 'user-1' }, accountId: 'acct-1' });
    load.mockResolvedValueOnce(crystallizableRun());
    adoptComposedSpec.mockClear();
    const out = await adoptCrystal('run-1', 'My follow-ups', { kind: 'schedule', schedule: 'daily.morning' });
    expect('refused' in out).toBe(false);
    // The spec handed to adoptComposedSpec carries the RE-EXTRACTED steps.
    const adoptedSpec = (adoptComposedSpec.mock.calls[0] as unknown[])[2] as { steps: unknown };
    expect(adoptedSpec.steps).toEqual([{ capability: 'nudge.overdue-email', inputs: { staleDays: 3 } }]);
  });

  it('passes the source plan_run id for provenance + hatches as an egg', async () => {
    appSession.mockResolvedValueOnce({ user: { id: 'user-1' }, accountId: 'acct-1' });
    load.mockResolvedValueOnce(crystallizableRun());
    adoptComposedSpec.mockClear();
    const out = await adoptCrystal('run-1', 'My follow-ups', { kind: 'schedule', schedule: 'daily.morning' });
    if ('refused' in out || !out.ok) throw new Error('expected an egg hatch');
    expect(out.stage).toBe('egg');
    const opts = (adoptComposedSpec.mock.calls[0] as unknown[])[5] as { sourcePlanRunId?: string };
    expect(opts.sourcePlanRunId).toBe('run-1');
  });

  it('rejects a chosenTrigger that is not a known cadence (before any load)', async () => {
    appSession.mockResolvedValueOnce({ user: { id: 'user-1' }, accountId: 'acct-1' });
    // cadence is validated BEFORE the load — no load value queued (would leak).
    adoptComposedSpec.mockClear();
    load.mockClear();
    const out = await adoptCrystal('run-1', 'My follow-ups', { kind: 'schedule', schedule: 'hourly.always' });
    expect(out).toEqual({ refused: true, reason: 'bad_cadence' });
    expect(load).not.toHaveBeenCalled();
    expect(adoptComposedSpec).not.toHaveBeenCalled();
  });

  it('refuses a foreign-account run id (never leaks, never adopts)', async () => {
    appSession.mockResolvedValueOnce({ user: { id: 'user-1' }, accountId: 'acct-other' });
    load.mockResolvedValueOnce(null);
    adoptComposedSpec.mockClear();
    const out = await adoptCrystal('run-1', 'X', { kind: 'schedule', schedule: 'daily.morning' });
    expect(out).toEqual({ refused: true, reason: 'not_found' });
    expect(adoptComposedSpec).not.toHaveBeenCalled();
  });
});
