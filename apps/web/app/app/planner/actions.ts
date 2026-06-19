'use server';

/**
 * Planner server actions (Slice 3a, design §6). The ad-hoc ask flow:
 *  - proposePlan(intent) → planForIntent → {plan, preview} | {error} (NO run)
 *  - startPlanRun(plan)  → re-validate fail-closed → create + runPlan → outcome
 *  - respondToPlanRun(runId, response) → respondToRequest (resume)
 *
 * Every action is account-scoped via appSession; every one that touches a model
 * or effect re-validates the plan fail-closed FIRST (a tampered client plan is
 * refused with no run created — the loop can never be provisioned beyond the
 * validated surface).
 */
import { runPlan, validatePlanSpec, type PlanOutcome, type PlanSpec } from '@nibbin/runtime';
import { appSession } from '../../../lib/auth/app-session';
import { serviceClient } from '../../../lib/supabase/service';
import { activeConnections } from '../../../lib/runtime/engine';
import { planForIntent, PLAN_CEILINGS, type PlanPreview } from '../../../lib/planner/plan';
import { webSearchEnabled } from '../../../lib/planner/websearch';
import {
  SupabasePlanRunStore,
  respondToRequest,
  buildPlannerRunDeps,
  type PlanResponse,
} from '../../../lib/planner/run';

export type ProposeResult = { plan: PlanSpec; preview: PlanPreview } | { error: string };

/** FIX 4: most concurrent `running` plan runs an account may hold. A frontier
 *  ReAct loop is expensive; this caps egress + spend by account, fail-safe. */
const MAX_CONCURRENT_RUNNING = 3;

/** FIX 4: a lightweight per-account rate guard on the entry points — the same
 *  account may not kick off a propose/start more than once every few seconds.
 *  In-process + best-effort (a frontier-LLM call is the real cost; this just
 *  defangs a tight client loop). Fail-safe: never throws. */
const MIN_ENTRY_INTERVAL_MS = 3_000;
const lastEntryAt = new Map<string, number>();

/** Returns a clean error string if the account is calling too fast, else null.
 *  Records the attempt timestamp on success. */
function rateGuard(accountId: string): string | null {
  const now = Date.now();
  const prev = lastEntryAt.get(accountId) ?? 0;
  if (now - prev < MIN_ENTRY_INTERVAL_MS) {
    return 'You just started something — give it a second before trying again.';
  }
  lastEntryAt.set(accountId, now);
  // opportunistic cleanup so the map can't grow unbounded
  if (lastEntryAt.size > 10_000) {
    for (const [k, t] of lastEntryAt) if (now - t > 60_000) lastEntryAt.delete(k);
  }
  return null;
}

async function grantedProviders(accountId: string): Promise<string[]> {
  const svc = serviceClient();
  const conns = await activeConnections(svc, accountId);
  return conns.map((c) => c.provider);
}

/** Propose a plan for an intent — does NOT run. Account-scoped. */
export async function proposePlan(intent: string): Promise<ProposeResult> {
  const trimmed = intent.trim();
  if (!trimmed) return { error: 'Tell me what you would like a Nibbin to look into.' };
  const { user, accountId } = await appSession();
  const limited = rateGuard(accountId);
  if (limited) return { error: limited };
  const connections = await grantedProviders(accountId);
  return await planForIntent(accountId, user.id, trimmed, connections);
}

/**
 * Start a plan run from a reviewed plan. Re-validates fail-closed BEFORE any
 * model/effect — a tampered/off-surface client plan is refused, no run created.
 */
export async function startPlanRun(plan: PlanSpec): Promise<PlanOutcome | { error: string }> {
  const { user, accountId } = await appSession();
  const limited = rateGuard(accountId);
  if (limited) return { error: limited };
  const connections = await grantedProviders(accountId);
  const store = new SupabasePlanRunStore();

  // FIX 3a: ceilings are NOT user-meaningful — re-stamp the canonical
  // server-side ceilings onto whatever the client posted BEFORE validating or
  // running, so a crafted client plan can never widen the loop's budget.
  const safePlan: PlanSpec = { ...plan, ceilings: { ...PLAN_CEILINGS } };

  const problems = validatePlanSpec(safePlan, connections, { webSearchEnabled: webSearchEnabled() });
  if (problems.length > 0) {
    return { error: `That plan can't run as written: ${problems.join('; ')}` };
  }

  // FIX 4: concurrency cap — refuse cleanly if the account is already at the
  // running ceiling (never throw; a clean user-facing error).
  try {
    const running = await store.countRunning(accountId);
    if (running >= MAX_CONCURRENT_RUNNING) {
      return { error: `You already have ${running} plan runs going. Let one finish before starting another.` };
    }
  } catch (err) {
    console.error('[planner] countRunning failed (fail-safe: refuse start)', err instanceof Error ? err.message : err);
    return { error: 'Could not start the run right now — please try again in a moment.' };
  }

  // Create the ephemeral run row (plan snapshot), then drive the loop.
  const state = {
    runId: '',
    accountId,
    plan: safePlan,
    transcript: [],
    scratchpad: {},
    status: 'running' as const,
  };
  await store.create(state); // assigns state.runId

  const deps = await buildPlannerRunDeps(accountId, user.id, state.runId);
  // Persist under the created run id (deps.persist writes to plan_runs).
  const outcome = await runPlan(safePlan, { ...deps, newRunId: () => state.runId });
  await nudgeIfNeedsInput(accountId, outcome);
  return outcome;
}

/** Resume a paused run with the human's response (account-scoped). */
export async function respondToPlanRun(runId: string, response: PlanResponse): Promise<PlanOutcome> {
  const { user, accountId } = await appSession();
  // Build the live deps once, then hand respondToRequest a synchronous factory
  // that returns it (the deps don't depend on the rehydrated state shape).
  const deps = await buildPlannerRunDeps(accountId, user.id, runId);
  const outcome = await respondToRequest(runId, accountId, user.id, response, () => deps);
  await nudgeIfNeedsInput(accountId, outcome);
  return outcome;
}

/** When a run pauses for the human, drop a calm Notification Center nudge
 *  (#121) so it can be picked up later. Best-effort — never fails the run. */
async function nudgeIfNeedsInput(accountId: string, outcome: PlanOutcome): Promise<void> {
  if (outcome.kind !== 'needs_input') return;
  try {
    const svc = serviceClient();
    await svc.rpc('insert_system_notification', {
      p_account: accountId,
      p_kind: 'nudge',
      p_source_id: `plan_run:${outcome.runId}:${outcome.request.requestId}`,
      p_title: 'A Nibbin needs your okay',
      p_body:
        outcome.request.kind === 'approval'
          ? 'One of your Nibbins drafted something and is waiting for your approval before it does anything.'
          : `One of your Nibbins has a question: ${outcome.request.question}`,
      p_payload: { ctaPath: `/app/planner?run=${outcome.runId}`, ctaLabel: 'Open the run', runId: outcome.runId },
    });
  } catch (err) {
    console.error('[planner] needs_input nudge failed (best-effort)', err instanceof Error ? err.message : err);
  }
}
