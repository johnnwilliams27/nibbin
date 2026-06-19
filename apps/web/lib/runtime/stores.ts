import 'server-only';

/**
 * Supabase-backed runtime stores. Money- and trust-critical transitions go
 * through the M4 migration's security-definer RPCs (run_begin / run_resume /
 * run_finish / nibbin_promote) — each re-checks its invariant in SQL under a
 * per-account advisory lock, so these wrappers stay thin and a compromised
 * app layer still cannot overdraw, over-refund, or promote the unearned.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AdmissionRequest,
  AdmissionOutcome,
  EventSink,
  GrantStore,
  IdempotencyClaim,
  IdempotencyStore,
  OpenTrainingRequest,
  ProductEvent,
  ResourceClaimResult,
  ResourceClaimStore,
  ResumeOutcome,
  RoutineStore,
  RunStore,
  StepRecord,
  TrainingStore,
  TrainingWindow,
} from '@nibbin/runtime';
import type { SendRecordStore } from '@nibbin/connectors';
import { isProductEventName } from '@nibbin/runtime';

type Service = SupabaseClient;

export class SupabaseRunStore implements RunStore {
  constructor(private readonly svc: Service) {}

  async begin(req: AdmissionRequest): Promise<AdmissionOutcome> {
    const { data, error } = await this.svc.rpc('run_begin', {
      p_account: req.accountId,
      p_nibbin: req.nibbinId,
      p_trigger: {
        kind: req.trigger.kind,
        ...(req.trigger.key ? { key: req.trigger.key } : {}),
        ...(req.trigger.dedupeKey ? { dedupeKey: req.trigger.dedupeKey } : {}),
      },
      p_weight: req.weight,
      p_dedupe_key: req.trigger.dedupeKey ?? null,
      p_debounce_secs: req.debounceSecs,
      p_cooldown_secs: req.cooldownSecs,
      p_anomaly_multiplier: req.anomalyMultiplier,
      p_anomaly_floor: req.anomalyFloor,
    });
    if (error) throw new Error(`run_begin failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as
      | { run_id: string | null; outcome: string; balance: number }
      | undefined;
    if (!row) throw new Error('run_begin returned nothing');
    switch (row.outcome) {
      case 'started':
        return { kind: 'started', runId: row.run_id!, balance: row.balance };
      case 'queued_cap':
        return { kind: 'queued_cap', runId: row.run_id!, balance: row.balance };
      case 'deduped':
      case 'cooldown':
      case 'anomaly_paused':
      case 'nibbin_unavailable':
        return { kind: row.outcome };
      default:
        throw new Error(`run_begin returned unknown outcome ${row.outcome}`);
    }
  }

  async resume(runId: string): Promise<{ outcome: ResumeOutcome; balance: number }> {
    const { data, error } = await this.svc.rpc('run_resume', { p_run: runId });
    if (error) throw new Error(`run_resume failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as { outcome: ResumeOutcome; balance: number };
    return { outcome: row.outcome, balance: row.balance };
  }

  async finish(
    runId: string,
    status: 'awaiting_approval' | 'completed' | 'failed' | 'killed',
    modelMix?: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.svc.rpc('run_finish', {
      p_run: runId,
      p_status: status,
      p_model_mix: modelMix ?? {},
    });
    if (error) throw new Error(`run_finish failed: ${error.message}`);
  }

  async recordStep(accountId: string, runId: string, step: StepRecord): Promise<void> {
    const { error } = await this.svc.from('run_steps').insert({
      run_id: runId,
      account_id: accountId,
      idx: step.idx,
      kind: step.kind,
      tool: step.tool ?? null,
      input_hash: step.inputHash ?? null,
      model: step.model ?? null,
      tokens: step.tokens,
      payload: step.payload ?? {},
    });
    if (error) throw new Error(`run_steps insert failed: ${error.message}`);
  }
}

export class SupabaseRoutineStore implements RoutineStore {
  constructor(private readonly svc: Service) {}

  async approvedCount(nibbinId: string, patternKey: string): Promise<number> {
    // drafts carry their pattern key in the step payload; an approval row with
    // decision 'approved' (unedited) on that run counts toward routine trust
    const { data: steps, error } = await this.svc
      .from('run_steps')
      .select('run_id, runs!inner(nibbin_id)')
      .eq('kind', 'draft')
      .eq('runs.nibbin_id', nibbinId)
      .eq('payload->>patternKey', patternKey);
    if (error) throw new Error(`routine lookup failed: ${error.message}`);
    const runIds = (steps ?? []).map((s) => s.run_id as string);
    if (runIds.length === 0) return 0;
    const { count, error: e2 } = await this.svc
      .from('approvals')
      .select('id', { count: 'exact', head: true })
      .eq('decision', 'approved')
      .in('run_id', runIds);
    if (e2) throw new Error(`routine approval count failed: ${e2.message}`);
    return count ?? 0;
  }
}

/**
 * Training Mode (§18.1) store. STRICTLY ADDITIVE to School: it never touches the
 * gate path. `open`/`close` ride the membership-checked training_open /
 * training_close RPCs (caller's session — RLS holds); `recordSample` rides the
 * service-only training_sample RPC (the scheduler consumes a budget unit; a
 * client can never accelerate its own sampling). `active` is an RLS-scoped read
 * of the single open, in-time-box row — account-scoped by RLS so one account's
 * window can never be read against another's agent.
 */
function rowToWindow(r: {
  id: string;
  account_id: string;
  nibbin_id: string;
  started_at: string;
  expires_at: string;
  max_runs: number;
  runs_used: number;
  novelty: boolean;
  ended_at: string | null;
  ended_reason: string | null;
}): TrainingWindow {
  return {
    id: r.id,
    accountId: r.account_id,
    nibbinId: r.nibbin_id,
    startedAtMs: new Date(r.started_at).getTime(),
    expiresAtMs: new Date(r.expires_at).getTime(),
    maxRuns: r.max_runs,
    runsUsed: r.runs_used,
    novelty: r.novelty,
    ...(r.ended_at ? { endedAtMs: new Date(r.ended_at).getTime() } : {}),
    ...(r.ended_reason ? { endedReason: r.ended_reason as TrainingWindow['endedReason'] } : {}),
  };
}

export class SupabaseTrainingStore implements TrainingStore {
  constructor(private readonly svc: Service) {}

  async active(accountId: string, nibbinId: string, nowMs: number): Promise<TrainingWindow | null> {
    const { data, error } = await this.svc
      .from('training_sessions')
      .select('id, account_id, nibbin_id, started_at, expires_at, max_runs, runs_used, novelty, ended_at, ended_reason')
      .eq('account_id', accountId)
      .eq('nibbin_id', nibbinId)
      .is('ended_at', null)
      .gt('expires_at', new Date(nowMs).toISOString())
      .maybeSingle();
    if (error) throw new Error(`training active lookup failed: ${error.message}`);
    if (!data) return null;
    const w = rowToWindow(data);
    // double-check the budget bound client-side (the row should be auto-closed,
    // but a stale read must never sample over budget).
    return w.runsUsed >= w.maxRuns ? null : w;
  }

  async open(req: OpenTrainingRequest, _nowMs: number): Promise<TrainingWindow> {
    const { data, error } = await this.svc.rpc('training_open', {
      p_nibbin: req.nibbinId,
      p_duration_secs: Math.round(req.durationMs / 1000),
      p_max_runs: req.maxRuns,
      p_novelty: req.novelty,
    });
    if (error) throw new Error(`training_open failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as Parameters<typeof rowToWindow>[0] | null;
    if (!row) throw new Error('training_open returned nothing');
    return rowToWindow(row);
  }

  async recordSample(window: TrainingWindow, nowMs: number): Promise<TrainingWindow> {
    const { data, error } = await this.svc.rpc('training_sample', { p_nibbin: window.nibbinId });
    if (error) throw new Error(`training_sample failed: ${error.message}`);
    // training_sample returns runs_remaining (or NULL when it did NOT sample).
    const remaining = (Array.isArray(data) ? data[0] : data) as number | null;
    if (remaining === null) {
      // The RPC did NOT sample: the window is closed — but NULL does not tell us
      // WHY (expiry vs. budget vs. user opt-out). Reflect a closed window without
      // asserting a reason, so an expiry isn't mislabeled 'budget'. (trainingClosedBy
      // reads endedAtMs with an undefined/non-budget reason as the neutral 'time_box'.)
      return { ...window, endedAtMs: nowMs };
    }
    const runsUsed = window.maxRuns - remaining;
    const atBudget = runsUsed >= window.maxRuns;
    return {
      ...window,
      runsUsed,
      ...(atBudget ? { endedAtMs: nowMs, endedReason: 'budget' as const } : {}),
    };
  }

  async close(
    accountId: string,
    nibbinId: string,
    reason: TrainingWindow['endedReason'],
    _nowMs: number,
  ): Promise<void> {
    const { error } = await this.svc.rpc('training_close', {
      p_nibbin: nibbinId,
      p_reason: reason ?? 'user',
    });
    if (error) throw new Error(`training_close failed: ${error.message}`);
  }
}

export class SupabaseGrantStore implements GrantStore {
  constructor(private readonly svc: Service) {}

  async hasGrant(nibbinId: string, connectionId: string | undefined, capability: string): Promise<boolean> {
    if (!connectionId) return false;
    const { count, error } = await this.svc
      .from('nibbin_write_grants')
      .select('id', { count: 'exact', head: true })
      .eq('nibbin_id', nibbinId)
      .eq('connection_id', connectionId)
      .eq('capability', capability)
      .is('revoked_at', null);
    if (error) throw new Error(`grant lookup failed: ${error.message}`);
    return (count ?? 0) > 0;
  }
}

export class SupabaseIdempotencyStore implements IdempotencyStore {
  constructor(private readonly svc: Service) {}

  async claim(req: {
    accountId: string;
    runId: string;
    stepIdx: number;
    capability: string;
    idempotencyKey: string;
  }): Promise<IdempotencyClaim> {
    // claim-then-execute: the unique (account_id, idempotency_key) index makes
    // the claim atomic; an ignored duplicate means someone claimed before us
    const { data, error } = await this.svc
      .from('side_effects')
      .upsert(
        {
          account_id: req.accountId,
          run_id: req.runId,
          step_idx: req.stepIdx,
          capability: req.capability,
          idempotency_key: req.idempotencyKey,
        },
        { onConflict: 'account_id,idempotency_key', ignoreDuplicates: true },
      )
      .select('id');
    if (error) throw new Error(`idempotency claim failed: ${error.message}`);
    if ((data ?? []).length > 0) return 'claimed';

    const { data: existing, error: e2 } = await this.svc
      .from('side_effects')
      .select('executed_at')
      .eq('account_id', req.accountId)
      .eq('idempotency_key', req.idempotencyKey)
      .single();
    if (e2) throw new Error(`idempotency read failed: ${e2.message}`);
    return existing.executed_at ? 'already_executed' : 'unknown_outcome';
  }

  async markExecuted(accountId: string, idempotencyKey: string): Promise<void> {
    const { error } = await this.svc
      .from('side_effects')
      .update({ executed_at: new Date().toISOString() })
      .eq('account_id', accountId)
      .eq('idempotency_key', idempotencyKey);
    if (error) throw new Error(`idempotency mark failed: ${error.message}`);
  }
}

/**
 * Resource-claim store (Slice 1, §18.3) — the service-role implementation of the
 * conflict-detection claim. Calls the `claim_resource` RPC before an irreversible
 * send. On any infra error it THROWS (never returns granted=false): the runner
 * catches and fails open, so conflict detection degrading never drops a
 * legitimate send.
 */
export class SupabaseResourceClaimStore implements ResourceClaimStore {
  constructor(private readonly svc: Service) {}

  async claim(req: {
    accountId: string;
    nibbinId: string;
    runId: string;
    resourceType: string;
    resourceId: string;
  }): Promise<ResourceClaimResult> {
    const { data, error } = await this.svc.rpc('claim_resource', {
      p_account: req.accountId,
      p_nibbin: req.nibbinId,
      p_run: req.runId,
      p_resource_type: req.resourceType,
      p_resource_id: req.resourceId,
    });
    if (error) throw new Error(`claim_resource failed: ${error.message}`);
    // claim_resource RETURNS TABLE → supabase-js surfaces it as a row array.
    const row = (Array.isArray(data) ? data[0] : data) as
      | { granted: boolean; holder_run: string; holder_nibbin: string }
      | undefined;
    if (!row) throw new Error('claim_resource returned no row');
    return { granted: row.granted, holderRun: row.holder_run, holderNibbin: row.holder_nibbin };
  }
}

export class SupabaseSendRecordStore implements SendRecordStore {
  constructor(private readonly svc: Service) {}

  async recentSends(accountId: string, provider: string, sinceMs: number): Promise<number[]> {
    const { data, error } = await this.svc
      .from('send_records')
      .select('sent_at')
      .eq('account_id', accountId)
      .eq('provider', provider)
      .gt('sent_at', new Date(sinceMs).toISOString());
    if (error) throw new Error(`recentSends failed: ${error.message}`);
    return (data ?? []).map((r) => new Date(r.sent_at as string).getTime());
  }

  async recordSend(accountId: string, provider: string, atMs: number): Promise<void> {
    const { error } = await this.svc.from('send_records').insert({
      account_id: accountId,
      provider,
      sent_at: new Date(atMs).toISOString(),
    });
    if (error) throw new Error(`recordSend failed: ${error.message}`);
  }
}

export class SupabaseEventSink implements EventSink {
  constructor(private readonly svc: Service) {}

  async emit(event: ProductEvent): Promise<void> {
    if (!isProductEventName(event.name)) throw new Error(`unknown product event: ${event.name}`);
    const { error } = await this.svc.rpc('emit_product_event', {
      p_account: event.accountId ?? null,
      p_name: event.name,
      p_props: { ...(event.props ?? {}), ...(event.userId ? { userId: event.userId } : {}) },
    });
    if (error) throw new Error(`emit_product_event failed: ${error.message}`);
  }
}
