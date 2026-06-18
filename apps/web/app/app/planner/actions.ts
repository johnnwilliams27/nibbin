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
import { planForIntent, type PlanPreview } from '../../../lib/planner/plan';
import { webSearchEnabled } from '../../../lib/planner/websearch';
import {
  SupabasePlanRunStore,
  respondToRequest,
  buildPlannerRunDeps,
  type PlanResponse,
} from '../../../lib/planner/run';

export type ProposeResult = { plan: PlanSpec; preview: PlanPreview } | { error: string };

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
  const connections = await grantedProviders(accountId);
  return await planForIntent(accountId, user.id, trimmed, connections);
}

/**
 * Start a plan run from a reviewed plan. Re-validates fail-closed BEFORE any
 * model/effect — a tampered/off-surface client plan is refused, no run created.
 */
export async function startPlanRun(plan: PlanSpec): Promise<PlanOutcome | { error: string }> {
  const { user, accountId } = await appSession();
  const connections = await grantedProviders(accountId);

  const problems = validatePlanSpec(plan, connections, { webSearchEnabled: webSearchEnabled() });
  if (problems.length > 0) {
    return { error: `That plan can't run as written: ${problems.join('; ')}` };
  }

  // Create the ephemeral run row (plan snapshot), then drive the loop.
  const store = new SupabasePlanRunStore();
  const state = {
    runId: '',
    accountId,
    plan,
    transcript: [],
    scratchpad: {},
    status: 'running' as const,
  };
  await store.create(state); // assigns state.runId

  const deps = await buildPlannerRunDeps(accountId, user.id);
  // Persist under the created run id (deps.persist writes to plan_runs).
  const outcome = await runPlan(plan, { ...deps, newRunId: () => state.runId });
  await nudgeIfNeedsInput(accountId, outcome);
  return outcome;
}

/** Resume a paused run with the human's response (account-scoped). */
export async function respondToPlanRun(runId: string, response: PlanResponse): Promise<PlanOutcome> {
  const { user, accountId } = await appSession();
  // Build the live deps once, then hand respondToRequest a synchronous factory
  // that returns it (the deps don't depend on the rehydrated state shape).
  const deps = await buildPlannerRunDeps(accountId, user.id);
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
