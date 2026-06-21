/**
 * Runtime store interfaces + in-memory implementations.
 *
 * The Supabase-backed implementations (apps/web) call the M4 migration RPCs —
 * run_begin / run_resume / run_finish / nibbin_promote / nibbin_demote — which
 * re-enforce every money- and trust-critical check in SQL under per-account
 * advisory locks. The in-memory implementations mirror that behavior exactly
 * (same outcomes, same refund caps) so the §6.2 invariant suite runs without
 * a database; the RLS suite proves the SQL side.
 */
import { balance as ledgerBalance, validateAppend, WEIGHTS, type LedgerEntry, type WeightClass } from '@nibbin/shared';
import type { AdmissionOutcome, RunStatus, RunTrigger, StepRecord } from './types';

export interface AdmissionRequest {
  accountId: string;
  nibbinId: string;
  trigger: RunTrigger;
  weight: WeightClass;
  debounceSecs: number;
  cooldownSecs: number;
  anomalyMultiplier: number;
  anomalyFloor: number;
  /** Seeded into the in-memory store so getNibbin returns fresh stage during a run (#43). */
  nibbinStage?: import('./types').StageName;
  nibbinStageChangedAt?: number;
}

/** run_resume re-faces every admission gate, so it can return any of these. */
export type ResumeOutcome = 'started' | 'still_capped' | 'cooldown' | 'anomaly_paused' | 'nibbin_unavailable';

export interface NibbinCurrentState {
  stage: import('./types').StageName;
  stageChangedAt: number;
  status: 'active' | 'paused' | 'sleeping';
  actionLevel: 'observe' | 'draft' | 'send';
}

export interface RunStore {
  /** §6.2 admission: dedupe, cooldown, anomaly, pre-run budget check + charge. */
  begin(req: AdmissionRequest): Promise<AdmissionOutcome>;
  /** Start a cap-queued run once credits arrived — re-checks every gate. */
  resume(runId: string): Promise<{ outcome: ResumeOutcome; balance: number }>;
  /** Terminal transitions; failed/killed auto-refund, capped per run. */
  finish(runId: string, status: 'awaiting_approval' | 'completed' | 'failed' | 'killed', modelMix?: Record<string, unknown>): Promise<void>;
  recordStep(accountId: string, runId: string, step: StepRecord): Promise<void>;
  /**
   * Re-read a Nibbin's current stage+status from the store. Used by the runner
   * immediately before the execute branch to guard against a demotion or pause
   * that happened after admission (#43). Returns null if the nibbin is not
   * found (treat as unavailable → abort).
   */
  getNibbin(nibbinId: string): Promise<NibbinCurrentState | null>;
}

export interface RoutineStore {
  /**
   * Approved-unedited count for an identical pattern in the Nibbin's current
   * stage tenure (§4.7 Senior autonomy, #44). `sinceMs` is `stageChangedAt`
   * in Unix-ms — approvals decided before that instant don't count, so a
   * demotion truly resets the pattern's climb.
   */
  approvedCount(nibbinId: string, patternKey: string, sinceMs: number): Promise<number>;
}

export interface GrantStore {
  /**
   * C8 structural write grants (issue #26): a side effect may execute only
   * when a per-Nibbin grant row exists for exactly this capability on this
   * connection — never because a scope string sits in connections.scopes.
   */
  hasGrant(nibbinId: string, connectionId: string | undefined, capability: string): Promise<boolean>;
}

export type IdempotencyClaim = 'claimed' | 'already_executed' | 'unknown_outcome';

export interface IdempotencyStore {
  /**
   * Atomically claim a side-effect key (§6.2). 'unknown_outcome' = a prior
   * claim never confirmed execution — at-most-once means NEVER retrying it.
   */
  claim(req: {
    accountId: string;
    runId: string;
    stepIdx: number;
    capability: string;
    idempotencyKey: string;
  }): Promise<IdempotencyClaim>;
  markExecuted(accountId: string, idempotencyKey: string): Promise<void>;
}

/* ── In-memory implementations (tests, harnesses) ─────────────────────────── */

interface MemoryRun {
  id: string;
  accountId: string;
  nibbinId: string;
  trigger: RunTrigger;
  status: RunStatus;
  weight: WeightClass;
  createdAtMs: number;
  /** set when the run actually starts (charges) — null while cap-queued */
  startedAtMs?: number;
  steps: StepRecord[];
}

export interface MemoryNibbinState {
  status: 'active' | 'paused' | 'sleeping';
  pausedReason?: 'anomaly' | 'cap' | 'connection' | 'user';
  /** Stage tracking for mid-run re-check (#43). Defaults to 'student' if not set. */
  stage?: import('./types').StageName;
  stageChangedAt?: number;
  /** Permission model action level. Defaults to 'draft' if not set. */
  actionLevel?: 'observe' | 'draft' | 'send';
}

export class MemoryRunStore implements RunStore {
  readonly runs = new Map<string, MemoryRun>();
  readonly ledgers = new Map<string, LedgerEntry[]>();
  readonly nibbins = new Map<string, MemoryNibbinState>();
  private seq = 0;

  constructor(private readonly now: () => number = Date.now) {}

  seedCredits(accountId: string, credits: number): void {
    this.ledger(accountId).push({ delta: credits, reason: 'grant', sourceId: `seed-${++this.seq}` });
  }

  balance(accountId: string): number {
    return ledgerBalance(this.ledger(accountId));
  }

  nibbinState(nibbinId: string): MemoryNibbinState {
    let state = this.nibbins.get(nibbinId);
    if (!state) {
      state = { status: 'active' };
      this.nibbins.set(nibbinId, state);
    }
    return state;
  }

  private ledger(accountId: string): LedgerEntry[] {
    let l = this.ledgers.get(accountId);
    if (!l) {
      l = [];
      this.ledgers.set(accountId, l);
    }
    return l;
  }

  private runsOf(nibbinId: string): MemoryRun[] {
    return [...this.runs.values()].filter((r) => r.nibbinId === nibbinId);
  }

  async begin(req: AdmissionRequest): Promise<AdmissionOutcome> {
    const state = this.nibbinState(req.nibbinId);
    // Seed stage/stageChangedAt from admission so getNibbin reflects the current
    // stage; tests that demote mid-run update these fields directly on the state.
    if (req.nibbinStage !== undefined) state.stage = req.nibbinStage;
    if (req.nibbinStageChangedAt !== undefined) state.stageChangedAt = req.nibbinStageChangedAt;
    if (state.status !== 'active') return { kind: 'nibbin_unavailable' };

    const at = this.now();

    // dedupe within the debounce window
    if (req.trigger.dedupeKey) {
      const dup = this.runsOf(req.nibbinId).some(
        (r) => r.trigger.dedupeKey === req.trigger.dedupeKey && at - r.createdAtMs < req.debounceSecs * 1000,
      );
      if (dup) return { kind: 'deduped' };
    }

    // per-Nibbin cooldown + anomaly auto-pause (shared with resume)
    const block = this.admissionBlock(req.nibbinId, req.cooldownSecs, req.anomalyMultiplier, req.anomalyFloor);
    if (block) return { kind: block };

    // pre-run budget check against weighted credits; at cap: queue, explain
    const id = `run-${++this.seq}`;
    const bal = this.balance(req.accountId);
    if (bal < WEIGHTS[req.weight]) {
      this.runs.set(id, {
        id, accountId: req.accountId, nibbinId: req.nibbinId, trigger: req.trigger,
        status: 'queued', weight: req.weight, createdAtMs: at, steps: [],
      });
      return { kind: 'queued_cap', runId: id, balance: bal };
    }

    const entry: LedgerEntry = { delta: -WEIGHTS[req.weight], reason: 'run', runId: id };
    validateAppend(this.ledger(req.accountId), entry);
    this.ledger(req.accountId).push(entry);
    this.runs.set(id, {
      id, accountId: req.accountId, nibbinId: req.nibbinId, trigger: req.trigger,
      status: 'running', weight: req.weight, createdAtMs: at, startedAtMs: at, steps: [],
    });
    return { kind: 'started', runId: id, balance: bal - WEIGHTS[req.weight] };
  }

  async resume(runId: string): Promise<{ outcome: ResumeOutcome; balance: number }> {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'queued') throw new Error(`run ${runId} is not queued`);
    // re-face the admission gates as of NOW: a Nibbin paused/asleep since
    // queuing must not launch, and cooldown + anomaly are re-evaluated so the
    // queue→top-up path can't bypass the §6.2 ceiling (mirrors run_resume SQL).
    const state = this.nibbinState(run.nibbinId);
    if (state.status !== 'active') return { outcome: 'nibbin_unavailable', balance: this.balance(run.accountId) };
    // cooldown 0 on resume (trigger-frequency control, not a queue gate); the
    // anomaly ceiling still caps daily volume on the queue-drain path.
    const block = this.admissionBlock(run.nibbinId, 0, 5, 10);
    if (block) return { outcome: block, balance: this.balance(run.accountId) };

    const bal = this.balance(run.accountId);
    if (bal < WEIGHTS[run.weight]) return { outcome: 'still_capped', balance: bal };
    const entry: LedgerEntry = { delta: -WEIGHTS[run.weight], reason: 'run', runId };
    validateAppend(this.ledger(run.accountId), entry);
    this.ledger(run.accountId).push(entry);
    run.status = 'running';
    run.startedAtMs = this.now();
    return { outcome: 'started', balance: bal - WEIGHTS[run.weight] };
  }

  /** Shared cooldown + anomaly gate (mirrors private.run_admission_block). */
  private admissionBlock(
    nibbinId: string,
    cooldownSecs: number,
    anomalyMultiplier: number,
    anomalyFloor: number,
  ): 'cooldown' | 'anomaly_paused' | null {
    const at = this.now();
    const started = this.runsOf(nibbinId)
      .map((r) => r.startedAtMs)
      .filter((t): t is number => t !== undefined);
    const last = started.length > 0 ? Math.max(...started) : 0;
    if (last > 0 && at - last < cooldownSecs * 1000) return 'cooldown';

    const dayStart = new Date(at).setUTCHours(0, 0, 0, 0);
    const today = started.filter((t) => t >= dayStart).length;
    const trailing = started.filter((t) => t >= dayStart - 7 * 86_400_000 && t < dayStart).length;
    const baseline = trailing / 7;
    if (today + 1 > Math.max(anomalyFloor, Math.ceil(anomalyMultiplier * baseline))) {
      const state = this.nibbinState(nibbinId);
      state.status = 'paused';
      state.pausedReason = 'anomaly';
      return 'anomaly_paused';
    }
    return null;
  }

  async finish(runId: string, status: 'awaiting_approval' | 'completed' | 'failed' | 'killed'): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`unknown run ${runId}`);
    if (run.status !== 'running' && run.status !== 'queued') {
      throw new Error(`run ${runId} is ${run.status} — cannot finish`);
    }
    run.status = status;
    if (status === 'failed' || status === 'killed') {
      // auto-refund, capped at the run's remaining charge
      const ledger = this.ledger(run.accountId);
      const charged = ledger.filter((e) => e.runId === runId && e.reason === 'run').reduce((s, e) => s - e.delta, 0);
      const refunded = ledger.filter((e) => e.runId === runId && e.reason === 'refund').reduce((s, e) => s + e.delta, 0);
      const refundable = charged - refunded;
      if (refundable > 0) {
        const entry: LedgerEntry = { delta: refundable, reason: 'refund', runId };
        validateAppend(ledger, entry);
        ledger.push(entry);
      }
    }
  }

  async recordStep(_accountId: string, runId: string, step: StepRecord): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`unknown run ${runId}`);
    run.steps.push(step);
  }

  /**
   * Test helper: return all recorded steps for a run. Used by lifecycle tests
   * that assert on run_steps.payload.nativeDraftRef (Task 4).
   */
  getSteps(runId: string): StepRecord[] {
    return this.runs.get(runId)?.steps ?? [];
  }

  async getNibbin(nibbinId: string): Promise<NibbinCurrentState | null> {
    // nibbinState() auto-creates a default { status: 'active' } entry, mirroring
    // how begin() treats an unseen nibbin. We never return null from the in-memory
    // store (a real DB store returns null only if the row doesn't exist).
    const state = this.nibbinState(nibbinId);
    return {
      stage: state.stage ?? 'student',
      stageChangedAt: state.stageChangedAt ?? 0,
      status: state.status,
      actionLevel: state.actionLevel ?? 'draft',
    };
  }
}

export class MemoryGrantStore implements GrantStore {
  private grants = new Set<string>();

  grant(nibbinId: string, connectionId: string, capability: string): void {
    this.grants.add(`${nibbinId}:${connectionId}:${capability}`);
  }

  async hasGrant(nibbinId: string, connectionId: string | undefined, capability: string): Promise<boolean> {
    if (!connectionId) return false;
    return this.grants.has(`${nibbinId}:${connectionId}:${capability}`);
  }
}

export class MemoryRoutineStore implements RoutineStore {
  /** Each approval stored with its decision timestamp so stage-scoping works. */
  private approvals = new Map<string, number[]>();

  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  approve(nibbinId: string, patternKey: string, atMs?: number): void {
    const key = `${nibbinId}:${patternKey}`;
    const list = this.approvals.get(key) ?? [];
    list.push(atMs ?? this.now());
    this.approvals.set(key, list);
  }

  async approvedCount(nibbinId: string, patternKey: string, sinceMs: number): Promise<number> {
    const list = this.approvals.get(`${nibbinId}:${patternKey}`) ?? [];
    return list.filter((t) => t >= sinceMs).length;
  }
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private claims = new Map<string, { executed: boolean }>();

  async claim(req: { accountId: string; idempotencyKey: string }): Promise<IdempotencyClaim> {
    const key = `${req.accountId}:${req.idempotencyKey}`;
    const existing = this.claims.get(key);
    if (existing) return existing.executed ? 'already_executed' : 'unknown_outcome';
    this.claims.set(key, { executed: false });
    return 'claimed';
  }

  async markExecuted(accountId: string, idempotencyKey: string): Promise<void> {
    const claim = this.claims.get(`${accountId}:${idempotencyKey}`);
    if (!claim) throw new Error('marking an unclaimed idempotency key');
    claim.executed = true;
  }
}

/* ── §18.3 Multi-agent conflict detection ─────────────────────────────────── */

export interface ResourceClaimResult {
  granted: boolean;
  /** The run that currently holds the resource (our own run_id on grant). */
  holderRun: string;
  /** The nibbin that currently holds the resource. */
  holderNibbin: string;
}

/**
 * Store interface for resource claims (Slice 1, §18.3). The service-role
 * Supabase implementation calls `claim_resource`; the in-memory implementation
 * mirrors the SQL semantics for unit tests. Absent (undefined) = conflict
 * detection not wired (safe: fail-open — the send still fires).
 */
export interface ResourceClaimStore {
  /**
   * Atomically claim a resource before an irreversible send.
   *   granted=true  → this run holds the resource; proceed with the send.
   *   granted=false → another active run holds it; skip the send.
   * Idempotent for the same run (a retry returns granted=true again).
   * Infra errors must NOT be surfaced as granted=false — callers catch and
   * fail-open (proceed with the send despite the error).
   */
  claim(req: {
    accountId: string;
    nibbinId: string;
    runId: string;
    resourceType: string;
    resourceId: string;
  }): Promise<ResourceClaimResult>;
}

export class MemoryResourceClaimStore implements ResourceClaimStore {
  /**
   * active[`account:type:id`] = { runId, nibbinId } — mirrors the DB unique
   * index on (account_id, resource_type, resource_id) where released_at is null.
   */
  private active = new Map<string, { runId: string; nibbinId: string }>();

  async claim(req: {
    accountId: string;
    nibbinId: string;
    runId: string;
    resourceType: string;
    resourceId: string;
  }): Promise<ResourceClaimResult> {
    const key = `${req.accountId}:${req.resourceType}:${req.resourceId}`;
    const existing = this.active.get(key);
    if (!existing) {
      this.active.set(key, { runId: req.runId, nibbinId: req.nibbinId });
      return { granted: true, holderRun: req.runId, holderNibbin: req.nibbinId };
    }
    // Idempotent re-claim for the same run.
    if (existing.runId === req.runId) {
      return { granted: true, holderRun: req.runId, holderNibbin: req.nibbinId };
    }
    // Another run holds it → conflict.
    return { granted: false, holderRun: existing.runId, holderNibbin: existing.nibbinId };
  }

  /** Release all claims for a run (mirrors the ended_at trigger). */
  release(runId: string): void {
    for (const [key, holder] of this.active.entries()) {
      if (holder.runId === runId) this.active.delete(key);
    }
  }
}
