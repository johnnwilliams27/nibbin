import 'server-only';

/**
 * Planner run state — persistence + resumable escalation (Slice 3a, design §3).
 *
 * A plan run is ephemeral: no nibbins/agent_specs row, no tier-cap slot. Only
 * the run is persisted (in plan_runs), for resume + audit. Writes AND ask-human
 * both pause as ONE resumable `needs_input`; `respondToRequest` rehydrates the
 * state, appends the human's response (an approval decision, an auth grant, a
 * value, or free text) as the next observation, and resumes runPlan from the
 * persisted transcript.
 *
 * Account-scoping is load-bearing: a foreign runId can never be loaded or
 * resumed (the store filters on account_id; the SQL RLS is the last line).
 * Idempotent on a resolved request: a response to a request that no longer
 * matches `pending.requestId` returns the run's current terminal outcome, never
 * re-runs.
 */
import {
  runPlan,
  type PlanOutcome,
  type PlanRunState,
  type PlanTurn,
  type PlannerDeps,
} from '@nibbin/runtime';
import { serviceClient } from '../supabase/service';

export interface PlanRunStore {
  create(state: PlanRunState): Promise<void>;
  load(runId: string, accountId: string): Promise<PlanRunState | null>;
  save(state: PlanRunState): Promise<void>;
}

/** The human's answer to a pending request. */
export type PlanResponse =
  | { requestId: string; value: string }
  | { requestId: string; approval: 'approved' | 'rejected' };

/** Resolve a PlanOutcome from a terminal state (idempotent re-read). */
function terminalOutcome(state: PlanRunState): PlanOutcome {
  switch (state.status) {
    case 'done':
      return { kind: 'done', runId: state.runId, artifact: state.artifact };
    case 'needs_input':
      return { kind: 'needs_input', runId: state.runId, request: state.pending! };
    case 'failed':
      return { kind: 'failed', runId: state.runId, error: 'run failed' };
    case 'killed':
      return { kind: 'killed', runId: state.runId, reason: 'no_progress' };
    default:
      return { kind: 'failed', runId: state.runId, error: 'run is still running' };
  }
}

/**
 * Resume a paused run with the human's response. `depsFor` builds the
 * PlannerDeps for the rehydrated state (it needs the live model/connector
 * wiring, which this pure module doesn't own). Account-scoped + idempotent.
 */
export async function respondToRequest(
  runId: string,
  accountId: string,
  _userId: string,
  response: PlanResponse,
  depsFor: (state: PlanRunState) => PlannerDeps,
  store: PlanRunStore = new SupabasePlanRunStore(),
): Promise<PlanOutcome> {
  // Account-scoped load: a foreign runId returns null → never leak/resume.
  const state = await store.load(runId, accountId);
  if (!state) return { kind: 'failed', runId, error: 'run not found' };

  // Idempotent: only a needs_input run whose pending request matches resumes.
  if (state.status !== 'needs_input' || !state.pending) {
    return terminalOutcome(state);
  }
  if (state.pending.requestId !== response.requestId) {
    // A stale / already-resolved request — return the current outcome, no re-run.
    return terminalOutcome(state);
  }

  // Append the human's response as the observation on the pending turn, then
  // clear the pause. The runner's effect path executes an APPROVED draft.
  const lastTurn = lastPendingTurn(state.transcript);
  const observation = await resolveResponse(state, response, depsFor);
  if (lastTurn) lastTurn.observation = observation;

  state.pending = undefined;
  state.status = 'running';
  await store.save(state);

  // Resume the loop from the persisted transcript.
  return await runPlan(state.plan, depsFor(state), state);
}

/** The most recent turn that was a pause (ask_human or a connector draft). */
function lastPendingTurn(transcript: PlanTurn[]): PlanTurn | undefined {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const t = transcript[i];
    if ('ask_human' in t.pick || 'tool' in t.pick) return t;
  }
  return undefined;
}

/**
 * Turn the human response into the next observation. For an approval: execute
 * the held draft via the runner's effect executor (reusing the runner's effect
 * path) on 'approved', or note the rejection on 'rejected'. For a value/auth/
 * decision: the free-text answer is the observation.
 */
async function resolveResponse(
  state: PlanRunState,
  response: PlanResponse,
  depsFor: (state: PlanRunState) => PlannerDeps,
): Promise<string> {
  if ('approval' in response) {
    const ctx = state.pending?.context ?? {};
    if (response.approval === 'rejected') {
      return 'human rejected the draft';
    }
    // Approved: execute the held draft through the runner's effect executor
    // (the same path /approvals and the runner's execute branch use), with a
    // stable idempotency key so a double-resume can never double-send.
    const deps = depsFor(state);
    const capabilityId = String(ctx.tool ?? '');
    const connectionId = typeof ctx.connectionId === 'string' ? ctx.connectionId : undefined;
    const effectArgs = (ctx.effectArgs ?? {}) as Record<string, unknown>;
    const idempotencyKey = `plan:${state.runId}:${state.pending?.requestId ?? 'req'}`;
    try {
      await deps.runner.effects.execute({
        connectionId,
        capability: capabilityId,
        args: effectArgs,
        idempotencyKey,
      });
      return `human approved — executed ${capabilityId}`;
    } catch (err) {
      return `human approved, but execution failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  // value | auth | decision → the free-text answer is the observation.
  return `human answered: ${response.value}`;
}

/* ── In-memory store (tests / scripts) ──────────────────────────────────────── */

export class InMemoryPlanRunStore implements PlanRunStore {
  private rows = new Map<string, PlanRunState>();

  async create(state: PlanRunState): Promise<void> {
    this.rows.set(state.runId, structuredClone(state));
  }

  async load(runId: string, accountId: string): Promise<PlanRunState | null> {
    const row = this.rows.get(runId);
    if (!row || row.accountId !== accountId) return null;
    return structuredClone(row);
  }

  async save(state: PlanRunState): Promise<void> {
    this.rows.set(state.runId, structuredClone(state));
  }
}

/* ── Supabase-backed store (service-role RPCs from the migration) ───────────── */

interface PlanRunRow {
  id: string;
  account_id: string;
  goal: string;
  plan: PlanRunState['plan'];
  transcript: PlanTurn[];
  scratchpad: Record<string, string>;
  status: PlanRunState['status'];
  pending: PlanRunState['pending'] | null;
  artifact: unknown;
}

export class SupabasePlanRunStore implements PlanRunStore {
  async create(state: PlanRunState): Promise<void> {
    const svc = serviceClient();
    const { data, error } = await svc.rpc('plan_run_create', {
      p_account: state.accountId,
      p_user: null,
      p_goal: state.plan.goal,
      p_plan: state.plan,
    });
    if (error) throw new Error(`plan_run_create failed: ${error.message}`);
    if (typeof data === 'string') state.runId = data;
  }

  async load(runId: string, accountId: string): Promise<PlanRunState | null> {
    const svc = serviceClient();
    const { data, error } = await svc
      .from('plan_runs')
      .select('id, account_id, goal, plan, transcript, scratchpad, status, pending, artifact')
      .eq('id', runId)
      .eq('account_id', accountId) // account-scoped: a foreign runId yields null
      .maybeSingle();
    if (error || !data) return null;
    const row = data as PlanRunRow;
    return {
      runId: row.id,
      accountId: row.account_id,
      plan: row.plan,
      transcript: row.transcript ?? [],
      scratchpad: row.scratchpad ?? {},
      status: row.status,
      pending: row.pending ?? undefined,
      artifact: row.artifact ?? undefined,
    };
  }

  async save(state: PlanRunState): Promise<void> {
    const svc = serviceClient();
    const { error } = await svc.rpc('plan_run_save', {
      p_run: state.runId,
      p_transcript: state.transcript,
      p_scratchpad: state.scratchpad,
      p_status: state.status,
      p_pending: state.pending ?? null,
      p_artifact: state.artifact ?? null,
    });
    if (error) throw new Error(`plan_run_save failed: ${error.message}`);
  }
}
