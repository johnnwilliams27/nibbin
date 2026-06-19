import 'server-only';

/**
 * Channel-context planner wrappers (§7.3 Task 2).
 *
 * Principal-explicit equivalents of the `proposePlan`/`startPlanRun`/
 * `respondToPlanRun` server actions in `apps/web/app/app/planner/actions.ts`.
 * Callable from the service-role channel path — no `'use server'`, no
 * `appSession`. The `accountId` and `userId` are resolved upstream from a
 * `status='verified'` binding and passed explicitly.
 *
 * Core logic (ceiling re-stamp, validatePlanSpec fail-closed, concurrency cap,
 * store.create, buildPlannerRunDeps, runPlan) is REPLICATED here rather than
 * extracted into a shared `principal.ts`, because actions.ts is a stable,
 * gated surface and the refactor carries non-trivial risk (different import
 * contexts, different 'use server' requirements). The two copies are kept
 * intentionally parallel — a future cleanup should extract the shared core.
 *
 * TODO: converge with apps/web/app/app/planner/actions.ts by extracting the
 * ceiling-restamp + validate + concurrency + create + run core into
 * apps/web/lib/planner/principal.ts and having both files call it.
 *
 * NOTE: the in-process `rateGuard` from actions.ts is intentionally OMITTED
 * here. The per-turn `channel_turn_take` gate (turn limit + per-channel spend
 * cap, fail-closed) already wraps each inbound work turn and is the channel
 * path's rate guard.
 */

import {
  runPlan,
  validatePlanSpec,
  type PlanOutcome,
  type PlanSpec,
} from '@nibbin/runtime';
import { serviceClient } from '../supabase/service';
import { activeConnections } from '../runtime/engine';
import { planForIntent, PLAN_CEILINGS, type PlanPreview } from './plan';
import { webSearchEnabled } from './websearch';
import {
  SupabasePlanRunStore,
  buildPlannerRunDeps,
  respondToRequest,
  type PlanResponse,
  type PlanRunStore,
} from './run';

export type ProposeResult = { plan: PlanSpec; preview: PlanPreview } | { error: string };

/** FIX 4 (mirrored from actions.ts): maximum concurrent `running` plan runs
 *  per account. */
const MAX_CONCURRENT_RUNNING = 3;

// ── Dependency-injection seams (for testing) ──────────────────────────────

export interface StartPlanRunChannelOpts {
  /** Override the plan-run store (default: SupabasePlanRunStore). */
  store?: PlanRunStore;
  /** Override the deps builder (default: buildPlannerRunDeps). */
  buildDeps?: (
    accountId: string,
    userId: string,
    runId: string,
  ) => Promise<Awaited<ReturnType<typeof buildPlannerRunDeps>>>;
}

export interface RespondPlanRunChannelOpts {
  /** Override the plan-run store (default: SupabasePlanRunStore). */
  store?: PlanRunStore;
  /** Override the deps builder (default: buildPlannerRunDeps). */
  buildDeps?: (
    accountId: string,
    userId: string,
    runId: string,
  ) => Promise<Awaited<ReturnType<typeof buildPlannerRunDeps>>>;
}

// ── Shared helper ─────────────────────────────────────────────────────────

/**
 * Resolve the list of granted providers for an account. Mirrors the private
 * `grantedProviders` in actions.ts — exported here so conversation.ts can
 * pass connections into planForIntent without a second DB round-trip.
 */
export async function grantedProviders(accountId: string): Promise<string[]> {
  const svc = serviceClient();
  const conns = await activeConnections(svc, accountId);
  return conns.map((c) => c.provider);
}

// ── Channel wrappers ──────────────────────────────────────────────────────

/**
 * Propose a plan for an intent — does NOT run. Principal-explicit (no appSession).
 *
 * Mirrors `proposePlan` in actions.ts: resolves connections, then calls
 * `planForIntent`. The optional `generateOverride`/`routerOverride` seams are
 * forwarded so tests can inject a stub model without a real API key.
 */
export async function proposePlanForChannel(
  accountId: string,
  userId: string,
  intent: string,
): Promise<ProposeResult> {
  const trimmed = intent.trim();
  if (!trimmed) return { error: 'Tell me what you would like a Nibbin to look into.' };
  const connections = await grantedProviders(accountId);
  return planForIntent(accountId, userId, trimmed, connections);
}

/**
 * Start a plan run from a reviewed plan. Re-validates fail-closed BEFORE any
 * model/effect — a tampered/off-surface client plan is refused, no run created.
 *
 * Mirrors `startPlanRun` in actions.ts, but:
 *  - no `appSession` — principal is passed explicitly
 *  - no `rateGuard` — the channel_turn_take gate is the rate guard
 *  - accepts optional `store`/`buildDeps` injection seams for testing
 */
export async function startPlanRunForChannel(
  accountId: string,
  userId: string,
  plan: PlanSpec,
  opts: StartPlanRunChannelOpts = {},
): Promise<PlanOutcome | { error: string }> {
  const store: PlanRunStore = opts.store ?? new SupabasePlanRunStore();
  const depsBuilder = opts.buildDeps ?? buildPlannerRunDeps;

  // FIX 3a (mirrored): re-stamp the canonical server-side ceilings onto
  // whatever the client posted BEFORE validating or running, so a crafted
  // client plan can never widen the loop's budget.
  const safePlan: PlanSpec = { ...plan, ceilings: { ...PLAN_CEILINGS } };

  const connections = await grantedProviders(accountId);
  const problems = validatePlanSpec(safePlan, connections, { webSearchEnabled: webSearchEnabled() });
  if (problems.length > 0) {
    return { error: `That plan can't run as written: ${problems.join('; ')}` };
  }

  // FIX 4 (mirrored): concurrency cap — refuse cleanly if the account is
  // already at the running ceiling (never throw; a clean user-facing error).
  try {
    const running = await store.countRunning(accountId);
    if (running >= MAX_CONCURRENT_RUNNING) {
      return {
        error: `You already have ${running} plan runs going. Let one finish before starting another.`,
      };
    }
  } catch (err) {
    console.error(
      '[planner/channel] countRunning failed (fail-safe: refuse start)',
      err instanceof Error ? err.message : err,
    );
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

  const deps = await depsBuilder(accountId, userId, state.runId);
  return runPlan(safePlan, { ...deps, newRunId: () => state.runId });
}

/**
 * Resume a paused run with the human's response. Principal-explicit (no appSession).
 *
 * Mirrors `respondToPlanRun` in actions.ts but without appSession. Accepts
 * optional `store`/`buildDeps` seams for testing.
 */
export async function respondToPlanRunForChannel(
  accountId: string,
  userId: string,
  runId: string,
  response: PlanResponse,
  opts: RespondPlanRunChannelOpts = {},
): Promise<PlanOutcome> {
  const store: PlanRunStore = opts.store ?? new SupabasePlanRunStore();
  const depsBuilder = opts.buildDeps ?? buildPlannerRunDeps;

  const deps = await depsBuilder(accountId, userId, runId);
  return respondToRequest(runId, accountId, userId, response, () => deps, store);
}
