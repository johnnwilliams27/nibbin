/**
 * The run loop — every SPEC §6.2 invariant enforced HERE, at the runtime
 * layer, regardless of what a program (or one day a model) asks for:
 *
 *  - pre-run budget check + weighted charge (via RunStore.begin)
 *  - per-run ceilings: max steps, max tokens, wall clock
 *  - same-tool-same-args repetition kill
 *  - idempotency keys on every side-effectful action
 *  - tool access per-spec allowlisted
 *  - Agent School stage gates draft-vs-execute (school.ts), never the prompt
 *  - tool output without quarantine markers is refused (§6.5)
 */
import { createHash } from 'node:crypto';
import { isQuarantined, quarantine, type QuarantinedContent } from '@nibbin/connectors';
import { gateSideEffect } from './school';
import type { GrantStore, RoutineStore, RunStore, IdempotencyStore } from './stores';
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

export interface EffectExecutor {
  /**
   * Execute a side effect through the connector layer (which enforces C8
   * write-scope grants and RISKS §2 velocity caps unconditionally).
   */
  execute(req: {
    connectionId?: string;
    capability: string;
    args: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<void>;
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
  | { kind: 'failed'; error: string };

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

  // step.kind === 'draft': a proposed action. The Agent School gate — at the
  // runtime layer, never the prompt layer — decides draft vs execute.
  if (!spec.toolsAllowlist.includes(step.capability)) return done({ kind: 'kill', reason: 'allowlist' });

  const routineApprovals = await deps.routines.approvedCount(nibbin.id, step.patternKey);
  let gate = step.presentation
    ? ({ action: 'draft', reason: 'stage' } as const)
    : gateSideEffect(nibbin.stage, routineApprovals, spec.curriculum);

  if (gate.action === 'deny') return done({ kind: 'kill', reason: 'stage' });

  if (gate.action === 'execute') {
    const granted = await deps.grants.hasGrant(nibbin.id, step.connectionId, step.capability);
    if (!granted) gate = { action: 'draft', reason: 'stage' };
  }

  if (gate.action === 'draft') {
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
      },
    });
    return done({ kind: 'drafted', draft: step });
  }

  // gate.action === 'execute' (Senior on routine, Graduate within spec)
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
