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

      if (step.kind === 'read') {
        if (!spec.toolsAllowlist.includes(step.capability)) return await kill('allowlist');
        const repKey = `read:${step.capability}:${hashArgs(step.path)}`;
        const seen = (repetition.get(repKey) ?? 0) + 1;
        repetition.set(repKey, seen);
        if (seen >= REPETITION_KILL_AT) return await kill('repetition');

        const out = await deps.reader.read(step.connectionId, step.capability, step.path);
        // §6.5: external content is data, never instructions. The runtime
        // refuses tool output that lacks the quarantine markers.
        if (!isQuarantined(out.wrapped)) return await kill('unquarantined');

        await deps.runs.recordStep(nibbin.accountId, runId, {
          idx: idx++, kind: 'read', tool: step.capability, inputHash: hashArgs(step.path), tokens: 0,
        });
        feed = out;
        continue;
      }

      if (step.kind === 'compose') {
        if (step.prompt && deps.model) {
          // Pre-call ceiling (§6.2): the clamp happens BEFORE the call, so a
          // run can never buy more tokens than its spec has left.
          const remaining = ceilings.maxTokens - tokens;
          if (remaining <= 0) return await kill('max_tokens');
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
            // Record the compose step BEFORE the overshoot check: the model
            // call already happened and incurred COGS (model_calls row), so
            // the run's own step ledger must carry it even when the run is
            // then killed for exceeding the ceiling — otherwise the COGS row
            // is an orphan with no reconcilable step (gate finding
            // logic-skeptic P2).
            await deps.runs.recordStep(nibbin.accountId, runId, {
              idx: idx++,
              kind: 'compose',
              tokens: drafted.tokens,
              payload: { ...step.payload, model: true, ...(tokens > ceilings.maxTokens ? { overshoot: true } : {}) },
            });
            if (tokens > ceilings.maxTokens) return await kill('max_tokens');
            // Model output re-enters the program as quarantined content only
            // (§6.5): it was derived from external data and is data itself,
            // never instructions — same rule as connector reads.
            feed = quarantine(drafted.text, 'model');
            continue;
          }
          // Honest degradation: no model output → the program's deterministic
          // fallback composes the draft; the step records the miss.
          await deps.runs.recordStep(nibbin.accountId, runId, {
            idx: idx++, kind: 'compose', tokens: 0, payload: { ...step.payload, model: false, fallback: true },
          });
          continue;
        }
        tokens += step.tokens ?? 0;
        if (tokens > ceilings.maxTokens) return await kill('max_tokens');
        await deps.runs.recordStep(nibbin.accountId, runId, {
          idx: idx++, kind: 'compose', tokens: step.tokens ?? 0, payload: step.payload,
        });
        continue;
      }

      // step.kind === 'draft': a proposed action. The Agent School gate — at
      // the runtime layer, never the prompt layer — decides draft vs execute.
      if (!spec.toolsAllowlist.includes(step.capability)) return await kill('allowlist');

      const routineApprovals = await deps.routines.approvedCount(nibbin.id, step.patternKey);
      let gate = step.presentation
        ? ({ action: 'draft', reason: 'stage' } as const)
        : gateSideEffect(nibbin.stage, routineApprovals, spec.curriculum);

      if (gate.action === 'deny') return await kill('stage');

      // C8 structural grants (issue #26): without a per-Nibbin write-grant row
      // for this capability+connection, even an earned stage falls back to a
      // draft — autonomy never outruns granted access.
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
            gate: gate.reason, // 'stage' (Student) or 'novelty' (Senior flagging)
          },
        });
        await deps.runs.finish(runId, 'awaiting_approval');
        return { kind: 'awaiting_approval', runId, draft: step };
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
        // a prior attempt may or may not have landed — at-most-once means stop
        await deps.runs.finish(runId, 'failed');
        return { kind: 'failed', runId, error: 'side effect outcome unknown from a prior attempt — not retrying' };
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
      await deps.runs.finish(runId, 'completed');
      return { kind: 'executed', runId, effect: { capability: step.capability, idempotencyKey } };
    }

    await deps.runs.finish(runId, 'completed');
    return { kind: 'completed', runId };
  } catch (e) {
    await deps.runs.finish(runId, 'failed');
    return { kind: 'failed', runId, error: e instanceof Error ? e.message : String(e) };
  }
}
