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
  ProductEvent,
  ResumeOutcome,
  RoutineStore,
  RunStore,
  StepRecord,
} from '@nibbin/runtime';
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
