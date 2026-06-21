/**
 * The run loop — every SPEC §6.2 invariant enforced HERE, at the runtime
 * layer, regardless of what a program (or one day a model) asks for:
 *
 *  - pre-run budget check + weighted charge (via RunStore.begin)
 *  - per-run ceilings: max steps, max tokens, wall clock
 *  - same-tool-same-args repetition kill
 *  - idempotency keys on every side-effectful action
 *  - tool access per-spec allowlisted
 *  - Action level is the sole execution gate (owner-set): observe→no output,
 *    draft→draft, send→execute — identically at every grade (§ action-levels).
 *  - tool output without quarantine markers is refused (§6.5)
 */
import { createHash } from 'node:crypto';
import { isQuarantined, quarantine, type QuarantinedContent } from '@nibbin/connectors';
import type { GrantStore, ResourceClaimStore, RoutineStore, RunStore, IdempotencyStore } from './stores';
import type {
  DraftStep,
  KillReason,
  NibbinRef,
  ProgramStep,
  RunCeilings,
  RunResult,
  RunTrigger,
} from './types';
import type { EventSink } from './events';

/** Third identical call is a loop, not work. */
export const REPETITION_KILL_AT = 3;

export interface ToolReader {
  /** Read-only connector access; result must be quarantined external data. */
  read(connectionId: string, capability: string, path: string): Promise<QuarantinedContent>;
}

/** Result returned by EffectExecutor.execute. */
export interface EffectResult {
  /**
   * The Gmail draft id created by the native-draft mirror path (nativeDraft:true
   * at Draft action level). Only set on createDraft calls — undefined for sends,
   * deletes, calendar events, and every non-nativeDraft execution.
   */
  nativeDraftId?: string;
}

export interface EffectExecutor {
  /**
   * Execute a side effect through the connector layer (which enforces C8
   * write-scope grants and RISKS §2 velocity caps unconditionally).
   *
   * Returns `{ nativeDraftId }` when the execution created a native draft
   * (nativeDraft:true path); otherwise returns void / undefined.
   */
  execute(req: {
    connectionId?: string;
    capability: string;
    args: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<EffectResult | void>;
}

/**
 * The model seam (M6.5). The runner owns every model call a program asks
 * for: pre-call token clamping, quarantining the reply, recording real
 * counts. `null` means "no draft" (no model wired, outage, empty reply) —
 * programs MUST degrade to their deterministic text, never fail the run.
 */
export interface ModelDrafter {
  draft(req: {
    runId: string;
    nibbin: NibbinRef;
    intent: string;
    context: string;
    maxTokens: number;
  }): Promise<{ text: string; tokens: number } | null>;
}

export interface RunnerDeps {
  runs: RunStore;
  routines: RoutineStore;
  grants: GrantStore;
  idempotency: IdempotencyStore;
  reader: ToolReader;
  effects: EffectExecutor;
  events: EventSink;
  /** Absent = v0 behavior: every compose is deterministic, zero tokens. */
  model?: ModelDrafter;
  /**
   * §18.3 multi-agent conflict detection (Slice 1). Absent = no conflict
   * detection (fail-open: the send still fires). When present, `claim` is
   * called BEFORE every irreversible auto-execute send; a live conflict
   * (granted=false) skips the send and records a `resource_conflict` step
   * instead. Infra errors in `claim` are caught and treated as fail-open.
   */
  claims?: ResourceClaimStore;
  now(): number;
}

/**
 * A specialist program is a generator the runner DRIVES: it yields steps, and
 * for read steps receives the (quarantine-verified) result back. Every read,
 * compose, and proposed action passes through the runner's enforcement —
 * a program cannot touch a connector or emit an effect on its own.
 */
export type ProgramFn = (ctx: {
  nibbin: NibbinRef;
  trigger: RunTrigger;
}) => AsyncGenerator<ProgramStep, void, QuarantinedContent | undefined>;

export type RunOutcome =
  | RunResult
  | { kind: 'not_started'; why: 'queued_cap' | 'deduped' | 'cooldown' | 'anomaly_paused' | 'nibbin_unavailable' | 'egg'; runId?: string };

export function hashArgs(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex').slice(0, 32);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`;
}

/**
 * The side-effect idempotency key is stable for the same logical action: the
 * Nibbin, the pattern, the exact args and the triggering event. A retried
 * trigger (same dedupeKey) lands on the same key — at-most-once.
 */
export function effectIdempotencyKey(nibbin: NibbinRef, draft: DraftStep, trigger: RunTrigger, runId: string): string {
  const scope = trigger.dedupeKey ?? runId;
  return hashArgs([nibbin.id, draft.capability, draft.patternKey, draft.effectArgs, scope]);
}

/**
 * The disposition of ONE gated step (the per-step gating extracted from
 * executeRun's loop body so the Planner harness can reuse it verbatim — design
 * §1: "the runner's gates are unchanged and still apply to every yielded
 * step"). `dispatchStep` applies the same walls (allowlist, repetition,
 * quarantine, token clamp, School gate, write-grant, idempotency) and records
 * the step; it never decides the run's terminal status — the caller maps a
 * `drafted`/`executed`/`kill` disposition to the run outcome (so `executeRun`'s
 * behavior is byte-for-byte unchanged).
 */
export type StepDisposition =
  | { kind: 'read_result'; feed: QuarantinedContent }
  | { kind: 'composed'; feed?: QuarantinedContent }
  | { kind: 'drafted'; draft: DraftStep }
  | { kind: 'executed'; effect: { capability: string; idempotencyKey: string }; deduped: boolean }
  | { kind: 'kill'; reason: KillReason }
  | { kind: 'failed'; error: string }
  /**
   * §18.3 Slice 1: the irreversible send was skipped because another active
   * run already holds this resource. The run is NOT killed — it continues and
   * completes normally (the conflict is logged on the step). `holderNibbin` is
   * the nibbin that is already handling the resource.
   */
  | { kind: 'resource_conflict'; capability: string; resourceType: string; resourceId: string; holderNibbin: string };

/**
 * Derive the resource claim identity from a DraftStep that is about to auto-
 * execute. Returns `null` if no stable resource id can be derived from the
 * effectArgs — in that case the caller skips the claim (fail-open: the send
 * still fires, no false conflict). Resource identity keys:
 *   email.*       : effectArgs.threadId | inReplyTo → resource_type='email'
 *   invoice.nudge : effectArgs.invoiceId            → resource_type='invoice'
 */
export function deriveResourceClaim(step: DraftStep): { resourceType: string; resourceId: string } | null {
  const args = step.effectArgs;
  // email capabilities: threadId is the canonical per-thread identity.
  // inReplyTo is also accepted (some connectors use this field instead).
  if (step.capability === 'email.send') {
    const id =
      (typeof args.threadId === 'string' && args.threadId) ||
      (typeof args.inReplyTo === 'string' && args.inReplyTo);
    if (id) return { resourceType: 'email', resourceId: id };
  }
  // invoice capability: invoiceId is stable per Stripe invoice.
  if (step.capability === 'invoice.nudge') {
    const id = typeof args.invoiceId === 'string' && args.invoiceId;
    if (id) return { resourceType: 'invoice', resourceId: id };
  }
  // calendar.event-create: iCalUID is stable; fall back to a deterministic hash of
  // summary+start so two concurrent runs can't double-create the same logical event.
  if (step.capability === 'calendar.event-create') {
    const ev = typeof args.event === 'object' && args.event !== null ? (args.event as Record<string, unknown>) : {};
    const iCalUID = typeof ev.iCalUID === 'string' && ev.iCalUID;
    if (iCalUID) return { resourceType: 'calendar', resourceId: iCalUID };
    const summary = typeof ev.summary === 'string' ? ev.summary : '';
    const start = typeof ev.start === 'string' ? ev.start : (typeof (ev.start as Record<string, unknown> | undefined)?.dateTime === 'string' ? (ev.start as Record<string, unknown>).dateTime : '');
    if (summary || start) {
      // Stable deterministic id from summary + start — good enough for conflict detection.
      return { resourceType: 'calendar', resourceId: `${summary}|${start}` };
    }
  }
  // No derivable resource id → skip the claim (don't block the send).
  return null;
}

export interface DispatchCtx {
  nibbin: NibbinRef;
  trigger: RunTrigger;
  runId: string;
  idx: number;
  tokensSoFar: number;
  ceilings: RunCeilings;
  repetition: Map<string, number>;
  deps: RunnerDeps;
}

/**
 * Gate ONE ProgramStep. Returns the disposition plus the advanced counters
 * (`idxAfter`/`tokensAfter`) so the caller threads them into the next step.
 * This is a pure extraction of executeRun's loop body — the same recordStep
 * calls, the same gate logic, the same token clamp. It does NOT call
 * deps.runs.finish (the caller owns terminal status), and it does NOT enforce
 * the maxSteps/wall-clock guards (the caller owns the loop guards) — exactly
 * the split executeRun already had between its loop head and body.
 */
export async function dispatchStep(
  step: ProgramStep,
  ctx: DispatchCtx,
): Promise<StepDisposition & { idxAfter: number; tokensAfter: number }> {
  const { nibbin, trigger, runId, deps, ceilings, repetition } = ctx;
  const spec = nibbin.spec;
  let idx = ctx.idx;
  let tokens = ctx.tokensSoFar;
  const done = (d: StepDisposition): StepDisposition & { idxAfter: number; tokensAfter: number } => ({
    ...d,
    idxAfter: idx,
    tokensAfter: tokens,
  });

  if (step.kind === 'read') {
    if (!spec.toolsAllowlist.includes(step.capability)) return done({ kind: 'kill', reason: 'allowlist' });
    const repKey = `read:${step.capability}:${hashArgs(step.path)}`;
    const seen = (repetition.get(repKey) ?? 0) + 1;
    repetition.set(repKey, seen);
    if (seen >= REPETITION_KILL_AT) return done({ kind: 'kill', reason: 'repetition' });

    const out = await deps.reader.read(step.connectionId, step.capability, step.path);
    if (!isQuarantined(out.wrapped)) return done({ kind: 'kill', reason: 'unquarantined' });

    await deps.runs.recordStep(nibbin.accountId, runId, {
      idx: idx++, kind: 'read', tool: step.capability, inputHash: hashArgs(step.path), tokens: 0,
    });
    return done({ kind: 'read_result', feed: out });
  }

  if (step.kind === 'compose') {
    if (step.prompt && deps.model) {
      const remaining = ceilings.maxTokens - tokens;
      if (remaining <= 0) return done({ kind: 'kill', reason: 'max_tokens' });
      const maxTokens = Math.min(step.prompt.maxTokens ?? 1024, remaining);
      const drafted = await deps.model.draft({
        runId,
        nibbin,
        intent: step.prompt.intent,
        context: step.prompt.context,
        maxTokens,
      });
      if (drafted !== null) {
        tokens += drafted.tokens;
        await deps.runs.recordStep(nibbin.accountId, runId, {
          idx: idx++,
          kind: 'compose',
          tokens: drafted.tokens,
          payload: { ...step.payload, model: true, ...(tokens > ceilings.maxTokens ? { overshoot: true } : {}) },
        });
        if (tokens > ceilings.maxTokens) return done({ kind: 'kill', reason: 'max_tokens' });
        return done({ kind: 'composed', feed: quarantine(drafted.text, 'model') });
      }
      await deps.runs.recordStep(nibbin.accountId, runId, {
        idx: idx++, kind: 'compose', tokens: 0, payload: { ...step.payload, model: false, fallback: true },
      });
      return done({ kind: 'composed' });
    }
    tokens += step.tokens ?? 0;
    if (tokens > ceilings.maxTokens) return done({ kind: 'kill', reason: 'max_tokens' });
    await deps.runs.recordStep(nibbin.accountId, runId, {
      idx: idx++, kind: 'compose', tokens: step.tokens ?? 0, payload: step.payload,
    });
    return done({ kind: 'composed' });
  }

  // step.kind === 'draft': a proposed action. The action level gate —
  // owner-set, enforced at the runtime layer, never the prompt layer — decides
  // observe/draft/execute (§ action-levels).
  if (!spec.toolsAllowlist.includes(step.capability)) return done({ kind: 'kill', reason: 'allowlist' });

  // §43: Re-read the nibbin's current status immediately before the execute
  // decision. nibbin_demote / nibbin_pause is "one click, instant" — the
  // NibbinRef captured at admission may already be stale.
  const freshNibbin = await deps.runs.getNibbin(nibbin.id);
  if (!freshNibbin || freshNibbin.status !== 'active') {
    return done({ kind: 'drafted', draft: step });
  }

  // Action level is the sole execution gate (owner-set). Grade does not gate.
  // `step.presentation` steps are always drafts (they're proposals by construction).
  const level = freshNibbin.actionLevel;
  let gate: { action: 'execute' } | { action: 'draft'; reason: string } | { action: 'deny'; reason: string };
  if (step.presentation || level === 'draft') {
    gate = { action: 'draft', reason: 'level' };
  } else if (level === 'observe') {
    gate = { action: 'deny', reason: 'observe' };
  } else {
    gate = { action: 'execute' }; // level === 'send'
  }

  if (gate.action === 'deny') return done({ kind: 'kill', reason: gate.reason as KillReason });

  if (gate.action === 'draft') {
    // Native-draft mirror (Task 4): when the capability signals nativeDraft:true,
    // call the executor NOW (at draft time) to create the native Gmail draft. The
    // executor's nativeDraft path does NOT consume velocity and does NOT create an
    // idempotency row — it only calls createDraft and returns the id. We persist
    // the returned id in run_steps.payload.nativeDraftRef so dismiss-sync can
    // delete it and send-with-ref can use it instead of a fresh send.
    // Fail-open: if createDraft throws, we log the warning and record the draft
    // row WITHOUT a ref (the user can still approve/send, just without the
    // native-draft sync). This preserves the draft outcome invariant.
    let nativeDraftRef: string | undefined;
    if (step.effectArgs.nativeDraft === true) {
      try {
        const result = await deps.effects.execute({
          connectionId: step.connectionId,
          capability: step.capability,
          args: step.effectArgs,
          idempotencyKey: `native-draft:${hashArgs([nibbin.id, step.capability, step.effectArgs, runId])}`,
        });
        nativeDraftRef = result?.nativeDraftId;
      } catch (err) {
        // Best-effort: log and continue. The draft is still recorded; dismiss/send
        // will fall back gracefully (no ref = no native-draft cleanup/routing).
        console.warn('[runner] native-draft createDraft failed (non-fatal):', err instanceof Error ? err.message : String(err));
      }
    }

    await deps.runs.recordStep(nibbin.accountId, runId, {
      idx: idx++,
      kind: 'draft',
      tool: step.capability,
      inputHash: hashArgs(step.effectArgs),
      tokens: 0,
      payload: {
        title: step.title,
        draft: step.draft,
        patternKey: step.patternKey,
        effectArgs: step.effectArgs,
        connectionId: step.connectionId ?? null,
        gate: gate.reason,
        ...(nativeDraftRef !== undefined ? { nativeDraftRef } : {}),
      },
    });
    return done({ kind: 'drafted', draft: step });
  }

  // gate.action === 'execute' (action level is 'send')
  // §18.3 Slice 1: claim the resource BEFORE the idempotency claim. A
  // conflict-skip must NOT create an idempotency row — otherwise a same-key
  // event redelivery (missed-push reconcile / re-poll) would later read it as
  // 'unknown_outcome' and permanently refuse the deferred send. Fail-open: a
  // store THROW proceeds with the send; a genuine conflict (granted=false)
  // skips the send and records the conflict on the step.
  if (deps.claims) {
    const derived = deriveResourceClaim(step);
    if (derived) {
      let claimResult: { granted: boolean; holderRun: string; holderNibbin: string } | null = null;
      try {
        claimResult = await deps.claims.claim({
          accountId: nibbin.accountId,
          nibbinId: nibbin.id,
          runId,
          resourceType: derived.resourceType,
          resourceId: derived.resourceId,
        });
      } catch (err) {
        // Infra error → fail-open: log and proceed with the send.
        console.warn(
          '[runner] claim_resource infra error (fail-open) — proceeding with send:',
          err instanceof Error ? err.message : String(err),
        );
      }
      if (claimResult !== null && !claimResult.granted) {
        // Live conflict: another active run holds this resource. Skip the send.
        // No idempotency row was created (we claim the resource first), so a
        // later redelivery of the same event re-attempts the claim once the
        // holder releases — the deferred send is not permanently dropped.
        await deps.runs.recordStep(nibbin.accountId, runId, {
          idx: idx++,
          kind: 'execute',
          tool: step.capability,
          inputHash: hashArgs(step.effectArgs),
          tokens: 0,
          payload: {
            patternKey: step.patternKey,
            deduped: false,
            resourceConflict: true,
            resourceType: derived.resourceType,
            resourceId: derived.resourceId,
            holderNibbin: claimResult.holderNibbin,
          },
        });
        return done({
          kind: 'resource_conflict',
          capability: step.capability,
          resourceType: derived.resourceType,
          resourceId: derived.resourceId,
          holderNibbin: claimResult.holderNibbin,
        });
      }
    }
  }

  const idempotencyKey = effectIdempotencyKey(nibbin, step, trigger, runId);
  const claim = await deps.idempotency.claim({
    accountId: nibbin.accountId,
    runId,
    stepIdx: idx,
    capability: step.capability,
    idempotencyKey,
  });
  if (claim === 'unknown_outcome') {
    return done({ kind: 'failed', error: 'side effect outcome unknown from a prior attempt — not retrying' });
  }
  if (claim === 'claimed') {
    await deps.effects.execute({
      connectionId: step.connectionId,
      capability: step.capability,
      args: step.effectArgs,
      idempotencyKey,
    });
    await deps.idempotency.markExecuted(nibbin.accountId, idempotencyKey);
  }
  await deps.runs.recordStep(nibbin.accountId, runId, {
    idx: idx++,
    kind: 'execute',
    tool: step.capability,
    inputHash: hashArgs(step.effectArgs),
    tokens: 0,
    payload: { patternKey: step.patternKey, idempotencyKey, deduped: claim === 'already_executed' },
  });
  return done({ kind: 'executed', effect: { capability: step.capability, idempotencyKey }, deduped: claim === 'already_executed' });
}

export async function executeRun(
  nibbin: NibbinRef,
  trigger: RunTrigger,
  program: ProgramFn,
  deps: RunnerDeps,
): Promise<RunOutcome> {
  // §4.7: Eggs observe; they never run, draft, or spend.
  if (nibbin.stage === 'egg') return { kind: 'not_started', why: 'egg' };

  const spec = nibbin.spec;
  // debounce/cooldown come from the trigger definition that fired (matched by
  // kind + key), falling back to conservative defaults
  const def =
    spec.triggers.find(
      (t) =>
        t.kind === trigger.kind &&
        (t.kind === 'event' ? t.source === trigger.key : t.kind === 'schedule' ? t.schedule === trigger.key : true),
    ) ?? spec.triggers.find((t) => t.kind === trigger.kind);
  const debounce = def?.debounceSecs ?? 300;
  const cooldown = def?.cooldownSecs ?? 60;

  const admission = await deps.runs.begin({
    accountId: nibbin.accountId,
    nibbinId: nibbin.id,
    trigger,
    weight: spec.creditProfile.weightClass,
    debounceSecs: debounce,
    cooldownSecs: cooldown,
    anomalyMultiplier: 5,
    anomalyFloor: 10,
    nibbinStage: nibbin.stage,
    nibbinStageChangedAt: nibbin.stageChangedAt,
  });
  if (admission.kind !== 'started') {
    return admission.kind === 'queued_cap'
      ? { kind: 'not_started', why: 'queued_cap', runId: admission.runId }
      : { kind: 'not_started', why: admission.kind };
  }

  const runId = admission.runId;
  const startedAt = deps.now();
  const ceilings = spec.creditProfile.ceilings;
  const repetition = new Map<string, number>();
  let tokens = 0;
  let idx = 0;

  const kill = async (reason: KillReason): Promise<RunOutcome> => {
    await deps.runs.finish(runId, 'killed');
    return { kind: 'killed', runId, reason };
  };

  try {
    const it = program({ nibbin, trigger });
    let feed: QuarantinedContent | undefined = undefined;

    for (;;) {
      const next = await it.next(feed);
      feed = undefined;
      if (next.done) break;
      const step = next.value;

      if (idx >= ceilings.maxSteps) return await kill('max_steps');
      if (deps.now() - startedAt > ceilings.maxWallClockMs) return await kill('wall_clock');

      // The per-step gates live in dispatchStep (shared with the Planner
      // harness, design §1). It records the step and returns a disposition;
      // executeRun maps that disposition to the run's terminal status exactly
      // as before — no behavior change.
      const disp = await dispatchStep(step, {
        nibbin, trigger, runId, idx, tokensSoFar: tokens, ceilings, repetition, deps,
      });
      idx = disp.idxAfter;
      tokens = disp.tokensAfter;

      if (disp.kind === 'kill') return await kill(disp.reason);
      if (disp.kind === 'failed') {
        await deps.runs.finish(runId, 'failed');
        return { kind: 'failed', runId, error: disp.error };
      }
      if (disp.kind === 'drafted') {
        await deps.runs.finish(runId, 'awaiting_approval');
        return { kind: 'awaiting_approval', runId, draft: disp.draft };
      }
      if (disp.kind === 'executed') {
        await deps.runs.finish(runId, 'completed');
        return { kind: 'executed', runId, effect: disp.effect };
      }
      if (disp.kind === 'resource_conflict') {
        // The send was skipped; the run completes without double-acting.
        await deps.runs.finish(runId, 'completed');
        return {
          kind: 'completed',
          runId,
          // surface the conflict in the completed outcome so callers can log/notify
          resourceConflict: {
            capability: disp.capability,
            resourceType: disp.resourceType,
            resourceId: disp.resourceId,
            holderNibbin: disp.holderNibbin,
          },
        };
      }
      // read_result / composed → feed the (possibly quarantined) result back.
      feed = disp.feed;
    }

    await deps.runs.finish(runId, 'completed');
    return { kind: 'completed', runId };
  } catch (e) {
    await deps.runs.finish(runId, 'failed');
    return { kind: 'failed', runId, error: e instanceof Error ? e.message : String(e) };
  }
}
