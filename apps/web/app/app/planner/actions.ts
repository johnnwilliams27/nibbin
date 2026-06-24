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
import {
  crystallizabilityGate,
  runPlan,
  validatePlanSpec,
  isComputerUseCapability,
  COMPUTER_USE_CEILINGS,
  type AgentSpec,
  type CrystalRefusal,
  type PlanOutcome,
  type PlanSpec,
  type TriggerDef,
} from '@nibbin/runtime';
import { appSession } from '../../../lib/auth/app-session';
import { canStartNewWork, OUT_OF_CREDITS_MESSAGE } from '../../../lib/credits/gate';
import { serviceClient } from '../../../lib/supabase/service';
import { activeConnections } from '../../../lib/runtime/engine';
import { planForIntent, PLAN_CEILINGS, type PlanPreview } from '../../../lib/planner/plan';
import { webSearchEnabled } from '../../../lib/planner/websearch';
import { browserEnabled } from '../../../lib/planner/browser';
import { connectorsForSteps, crystallize, isStandardCadence, type CrystalPreview } from '../../../lib/planner/crystallize';
import { adoptComposedSpec } from '../../../lib/runtime/adopt';
import type { AdoptOutcome } from '../../../components/adopt/types';
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
  // running, so a crafted client plan can never widen the loop's budget. A plan
  // provisioning a computer_use (browser) verb is re-stamped with the tighter
  // computer_use ceilings + weight class (10×); otherwise the frontier defaults.
  const usesComputerUse = plan.toolsAllowlist.some((id) => isComputerUseCapability(id));
  const safePlan: PlanSpec = usesComputerUse
    ? { ...plan, weightClass: 'computer_use', ceilings: { ...COMPUTER_USE_CEILINGS } }
    : { ...plan, weightClass: 'frontier', ceilings: { ...PLAN_CEILINGS } };

  const problems = validatePlanSpec(safePlan, connections, { webSearchEnabled: webSearchEnabled(), browserEnabled: browserEnabled() });
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

  // Pre-flight credit gate (soft-gate, SPEC §6.2): STARTING a planner run — an
  // expensive frontier ReAct loop — requires a positive balance. A broke
  // account is refused cleanly with no run created and no model call. (Calls
  // that have ALREADY happened still charge + post via recordModelCall; only
  // new work is gated here.) Fail-closed: an unreadable ledger refuses.
  if (!(await canStartNewWork(accountId))) {
    return { error: OUT_OF_CREDITS_MESSAGE };
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
  // Close the (lazily-launched) browser in a `finally` so a paused or terminal
  // run never orphans a Chromium process; resume re-launches it lazily.
  let outcome: PlanOutcome;
  try {
    outcome = await runPlan(safePlan, { ...deps, newRunId: () => state.runId });
  } finally {
    await closeBrowserQuietly(deps);
  }
  await nudgeIfNeedsInput(accountId, outcome);
  return outcome;
}

/** Best-effort browser teardown — close the lazily-launched Chromium on a paused
 *  or terminal run so no process is orphaned. Never throws into the caller. */
async function closeBrowserQuietly(deps: { browser?: { close?: () => Promise<void> } }): Promise<void> {
  try {
    await deps.browser?.close?.();
  } catch (err) {
    console.error('[planner] browser close failed (best-effort)', err instanceof Error ? err.message : err);
  }
}

/** Resume a paused run with the human's response (account-scoped). */
export async function respondToPlanRun(runId: string, response: PlanResponse): Promise<PlanOutcome> {
  const { user, accountId } = await appSession();
  // Build the live deps once, then hand respondToRequest a synchronous factory
  // that returns it (the deps don't depend on the rehydrated state shape).
  const deps = await buildPlannerRunDeps(accountId, user.id, runId);
  let outcome: PlanOutcome;
  try {
    outcome = await respondToRequest(runId, accountId, user.id, response, () => deps);
  } finally {
    await closeBrowserQuietly(deps);
  }
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

/* ── Crystallization (Slice 4, design §6): a done plan_run → a durable B-spec ──
 *
 * proposeCrystal runs the gate server-side + returns the candidate (or the
 * refusal reason); adoptCrystal RE-DERIVES the spec from the SOURCE plan_run
 * (never a client-passed spec), applies the user's name + explicitly-chosen
 * cadence, re-validates fail-closed, and adopts as an EGG via adoptComposedSpec
 * with the source plan_run recorded for provenance. */

/** The refusal reasons surfaced to the preview UX — the gate's CrystalRefusal
 *  plus the action-layer guards (a foreign run id, a bad cadence). */
export type CrystalActionRefusal = CrystalRefusal | 'not_found' | 'bad_cadence' | 'rate_limited' | 'already_recurring';

export type CrystalProposeResult =
  | { spec: AgentSpec; preview: CrystalPreview }
  | { refused: true; reason: CrystalActionRefusal };

export type CrystalAdoptResult = AdoptOutcome | { refused: true; reason: CrystalActionRefusal };

/**
 * Propose a crystallized recurring agent for a SUCCESSFUL plan run. Account-
 * scoped: a foreign run id loads as null → `{refused, reason:'not_found'}` (never
 * leaks). The gate is the single authority on crystallizability. Does NOT adopt.
 */
export async function proposeCrystal(planRunId: string): Promise<CrystalProposeResult> {
  const { user, accountId } = await appSession();
  // FIX 4: proposeCrystal makes a budgeted soft-layer model call + hits the DB —
  // guard the entry point the same way proposePlan/startPlanRun do.
  const limited = rateGuard(accountId);
  if (limited) return { refused: true, reason: 'rate_limited' };
  const store = new SupabasePlanRunStore();
  const planRun = await store.load(planRunId, accountId);
  if (!planRun) return { refused: true, reason: 'not_found' };

  const connections = await grantedProviders(accountId);
  const result = await crystallize(planRun, user.id, connections);
  if ('refused' in result) return { refused: true, reason: result.reason };
  return result;
}

/**
 * Adopt a crystallized recurring agent. RE-LOADS the source plan_run + RE-RUNS
 * crystallize deterministically — it does NOT trust any client-passed spec, so a
 * tampered payload can't inject steps. The recurring trigger is the USER's
 * explicit choice (validated against the standard cadence set); a manual
 * {kind:'user'} trigger is always included. Re-validates fail-closed (inside
 * adoptComposedSpec), hatches as an EGG (no trust transfer), and records the
 * source plan_run id for provenance.
 */
export async function adoptCrystal(
  planRunId: string,
  chosenName: string,
  chosenTrigger: TriggerDef,
): Promise<CrystalAdoptResult> {
  const { user, accountId } = await appSession();

  // The recurring trigger is the user's choice — validate it's a known cadence
  // BEFORE any load/re-derive. A manual {kind:'user'} is always also added.
  if (chosenTrigger.kind !== 'schedule' || !chosenTrigger.schedule || !isStandardCadence(chosenTrigger.schedule)) {
    return { refused: true, reason: 'bad_cadence' };
  }

  // FIX 4: adoptCrystal both re-runs the budgeted soft-layer call (via
  // crystallize) and writes to the DB — guard the entry point.
  const limited = rateGuard(accountId);
  if (limited) return { refused: true, reason: 'rate_limited' };

  // Account-scoped re-load: a foreign run id → null (never leak / never adopt).
  const store = new SupabasePlanRunStore();
  const planRun = await store.load(planRunId, accountId);
  if (!planRun) return { refused: true, reason: 'not_found' };

  const connections = await grantedProviders(accountId);

  // FIX 9: surface a structured reconnect when a required connector grant was
  // revoked between run and adopt. We run the deterministic gate FIRST (cheap, no
  // LLM) to learn the steps' required connectors, then check them against the
  // live grants. If any is missing we return the "reconnect X" flow (mirroring
  // BuildNibbinButton/adoptSynthesized) instead of letting it fall through to
  // crystallize's generic `invalid_spec` refusal. (The gate refusing here is NOT
  // a connector miss — those refusals are the genuine crystallizability ones.)
  const gate = crystallizabilityGate(planRun, connections);
  if (!gate.ok && gate.reason === 'invalid_spec') {
    // The gate validates against current connections; an invalid_spec at adopt
    // time is most often a revoked grant. Re-derive the steps' connectors from
    // the connector-agnostic gate to tell the user which to reconnect.
    const fullGate = crystallizabilityGate(planRun, planRun.plan.requiredConnectors);
    if (fullGate.ok) {
      const need = connectorsForSteps(fullGate.steps);
      const have0 = new Set(connections);
      const missing0 = need.filter((p) => !have0.has(p));
      if (missing0.length > 0) {
        return {
          ok: false,
          redirectTo: `/app/planner?needs=${encodeURIComponent(missing0.join(','))}`,
        };
      }
    }
  }

  // Re-derive deterministically from the SOURCE — the steps come from the trace,
  // never from a round-tripped client payload.
  const derived = await crystallize(planRun, user.id, connections);
  if ('refused' in derived) return { refused: true, reason: derived.reason };

  // Apply the user's name + chosen cadence onto the re-derived spec. The steps
  // are NOT touched (faithfulness); only the soft layer (name) + trigger change.
  // FIX 7: clamp the (client-supplied) cooldown to the 1h floor so a crystallized
  // recurring agent always carries at least the standard cooldown.
  const name = (chosenName ?? '').trim().slice(0, 40) || derived.spec.displayName;
  const spec: AgentSpec = {
    ...derived.spec,
    displayName: name,
    triggers: [
      {
        kind: 'schedule',
        schedule: chosenTrigger.schedule,
        cooldownSecs: Math.max(3600, chosenTrigger.cooldownSecs ?? 3600),
      },
      { kind: 'user', debounceSecs: 0, cooldownSecs: 0 },
    ],
  };

  try {
    // adoptComposedSpec re-runs validateComposedSpec fail-closed BEFORE any write
    // and hatches the Nibbin as an EGG; the source plan_run is recorded.
    const adopted = await adoptComposedSpec(accountId, user.id, spec, name, undefined, {
      sourcePlanRunId: planRunId,
    });
    if (adopted.missingConnectors.length > 0) {
      return {
        ok: false,
        redirectTo: `/app/planner?needs=${encodeURIComponent(adopted.missingConnectors.join(','))}`,
      };
    }
    return {
      ok: true,
      nibbinId: adopted.nibbinId,
      name: adopted.name,
      species: adopted.species,
      stage: adopted.stage,
      palette: adopted.palette,
      accessory: adopted.accessory,
      marking: adopted.marking,
      isFirstAdoption: adopted.isFirstAdoption,
      ctaPath: '/app',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // FIX 6: the partial unique index (account_id, source_plan_run_id) stops a
    // double "Make this recurring" from minting duplicate agents. On the
    // conflict, return a clean "already made recurring" outcome, not a crash.
    if (/agent_specs_source_plan_run_uniq|duplicate key|unique constraint/i.test(msg)) {
      return { refused: true, reason: 'already_recurring' };
    }
    // FIX 9 (belt-and-suspenders): a connector revoked in the write window makes
    // adoptComposedSpec's validateComposedSpec throw "required connector … is not
    // connected" — surface the structured reconnect rather than a generic error.
    const revoked = derived.spec.requiredConnectors.filter((p) => msg.includes(`"${p}"`) && /not connected/i.test(msg));
    if (revoked.length > 0) {
      return {
        ok: false,
        redirectTo: `/app/planner?needs=${encodeURIComponent(revoked.join(','))}`,
      };
    }
    return { ok: false, redirectTo: '/app/planner?error=adopt' };
  }
}
