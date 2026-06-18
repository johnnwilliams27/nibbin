/**
 * runPlan — the supervised bounded-ReAct harness (Slice 3a, design §2.3/§7).
 *
 * Where interpretSpec front-loads a fixed `steps[]`, the Planner picks its next
 * tool at runtime over a VALIDATED, pre-provisioned surface. The safety thesis
 * (design §1) lives here AND in the validator:
 *
 *  - Provisioning is fixed at plan-preview. The picker selects ONLY among the
 *    plan's `toolsAllowlist` (connector caps + the fixed utility set). It can
 *    never grant itself a tool/connector/scope — needing more means escalating
 *    (ask_human → needs_input), never silent self-expansion.
 *  - `validatePick` re-validates EVERY pick fail-closed. An invalid pick yields
 *    NO step: the loop appends the reason as an observation and re-prompts ONCE;
 *    a second invalid pick fails the run cleanly.
 *  - Every yielded connector step rides the SAME runner gates via `dispatchStep`
 *    — allowlist, repetition, quarantine, the School gate, write-grants,
 *    idempotency, ceilings. The synthetic nibbin runs at the `student` stage so
 *    every side effect is approval-gated (a draft → needs_input(approval)); it
 *    can never auto-send.
 *  - Bounded: `maxIterations` + the existing `maxSteps`/`maxTokens`/
 *    `maxWallClockMs` ceilings + repetition-kill + a no-progress kill.
 *  - No deterministic fallback: a reasoning loop needs a model. A `null` pick
 *    (no model wired) fails the run cleanly with 'planning requires a model'.
 *
 * Ephemeral: there is no nibbins/agent_specs row and no tier-cap slot. The run
 * state (transcript + scratchpad + pending) is persisted by the injected store
 * (Task 3) for resume + audit only.
 */
import type { QuarantinedContent } from '@nibbin/connectors';
import { capability } from './capabilities';
import { dispatchStep, hashArgs, type RunnerDeps } from './runner';
import { interpretSpec } from './interpreter';
import { validatePick, type PlannerPickInput } from './validate';
import { plannerTool } from './utilities';
import type {
  AgentSpec,
  KillReason,
  NibbinRef,
  PendingRequest,
  PlanOutcome,
  PlanRunState,
  PlanSpec,
  PlanTurn,
  ProgramStep,
} from './types';

type PlanKillReason = KillReason | 'max_iterations' | 'no_progress';

/** The tool-picker model call — given the assembled context, choose the next
 *  move. `null` = no model available (the loop fails cleanly). */
export interface PlannerDrafter {
  pick(input: {
    goal: string;
    tools: string[];
    transcript: PlanTurn[];
    scratchpad: Record<string, string>;
    budget: { iterationsLeft: number; tokensLeft: number };
  }): Promise<PlannerPick | null>;
}

export type PlannerPick = PlannerPickInput;

/** Dispatch a utility pick (web/memory injected by apps/web; scratchpad/done
 *  handled in-harness). Returns the observation text (already quarantined for
 *  egressing utilities, plain for internal ones), or null if not handled. */
export interface UtilityDispatch {
  /** memory.retrieve → the RAG memory_entries (account-scoped, top-k). */
  memoryRetrieve?(query: string, k: number): Promise<string>;
  /** web.search → redact→egress→quarantine (apps/web/lib/planner/websearch). */
  webSearch?(query: string): Promise<string>;
  /** web.fetch → SSRF-guarded fetch→quarantine. */
  webFetch?(url: string): Promise<string>;
}

export interface PlanRunPersist {
  save(state: PlanRunState): Promise<void>;
}

export interface PlannerDeps {
  planner: PlannerDrafter;
  /** The runner deps dispatchStep uses to gate every connector step. */
  runner: RunnerDeps;
  /** Granted connector providers, for validatePick. */
  connectors: string[];
  /** provider → connectionId, to translate a connector pick into a ProgramStep. */
  connMap: Record<string, string | undefined>;
  accountId: string;
  /** Utility dispatch (web/memory). Absent web.* handlers → a clean error obs. */
  utilities?: UtilityDispatch;
  /** Persist the run state on each pause/checkpoint (Task 3). */
  persist?: PlanRunPersist;
  /** Injectable id factory (tests). */
  newRunId?: () => string;
  newRequestId?: () => string;
}

/** Consecutive no-observation/no-scratchpad-change iterations before a no-progress kill. */
export const NO_PROGRESS_KILL_AT = 3;

/** Longest observation we keep in the transcript (mirrors the read quarantine cap). */
const OBSERVATION_MAX_CHARS = 4000;

function cap(text: string, max = OBSERVATION_MAX_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
}

/** A synthetic NibbinRef for dispatchStep: `student` stage so EVERY side effect
 *  is approval-gated (gateSideEffect(student) → draft). Ephemeral — never an
 *  actual nibbins row; this is a runtime shell carrying the plan's allowlist +
 *  ceilings to the existing gates. */
function syntheticNibbin(plan: PlanSpec, runId: string): NibbinRef {
  const spec: AgentSpec = {
    templateKey: null,
    version: 1,
    displayName: 'Planner run',
    toolsAllowlist: plan.toolsAllowlist,
    requiredConnectors: plan.requiredConnectors,
    triggers: [{ kind: 'user' }],
    curriculum: {
      measures: 'plan run',
      promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95 },
      routineMinApprovals: 5,
    },
    creditProfile: { weightClass: plan.weightClass, ceilings: plan.ceilings },
    personaPolicy: plan.personaPolicy,
  };
  return { id: `plan:${runId}`, accountId: '', name: 'Planner run', stage: 'student', status: 'active', spec };
}

/** A one-step spec the interpreter turns into ProgramStep(s) for a connector
 *  pick — an atomic read (path from args) or a primitive (typed inputs). */
function stepSpecFor(tool: string, args: Record<string, unknown>, plan: PlanSpec): AgentSpec {
  const c = capability(tool)!;
  const inputs = c.kind === 'primitive' ? args : c.sideEffect === 'read' ? { path: args.path } : args;
  return {
    templateKey: null,
    version: 1,
    displayName: 'Planner step',
    toolsAllowlist: plan.toolsAllowlist,
    requiredConnectors: plan.requiredConnectors,
    triggers: [{ kind: 'user' }],
    curriculum: { measures: 'plan run', promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95 }, routineMinApprovals: 5 },
    creditProfile: { weightClass: plan.weightClass, ceilings: plan.ceilings },
    steps: [{ capability: tool, inputs }],
  };
}

export async function runPlan(
  plan: PlanSpec,
  deps: PlannerDeps,
  resume?: PlanRunState,
): Promise<PlanOutcome> {
  const runId = resume?.runId ?? deps.newRunId?.() ?? `plan-${Math.random().toString(36).slice(2)}`;
  const newRequestId = deps.newRequestId ?? (() => `req-${Math.random().toString(36).slice(2)}`);
  const state: PlanRunState = resume ?? {
    runId,
    accountId: deps.accountId,
    plan,
    transcript: [],
    scratchpad: {},
    status: 'running',
  };
  state.status = 'running';
  state.pending = undefined;

  const nibbin = syntheticNibbin(plan, runId);
  nibbin.accountId = deps.accountId;
  const ceilings = plan.ceilings;
  const repetition = new Map<string, number>();
  // Rebuild the repetition map from the resumed transcript so a resumed loop
  // can't bypass the repetition kill by forgetting prior reads.
  for (const t of state.transcript) {
    if ('tool' in t.pick && typeof t.pick.tool === 'string') {
      const c = capability(t.pick.tool);
      if (c && c.sideEffect === 'read' && c.kind !== 'primitive') {
        const path = (t.pick as { args: Record<string, unknown> }).args.path;
        repetition.set(`read:${t.pick.tool}:${hashArgs(path)}`, (repetition.get(`read:${t.pick.tool}:${hashArgs(path)}`) ?? 0) + 1);
      }
    }
  }
  const startedAt = deps.runner.now();
  let idx = state.transcript.length;
  let tokens = 0;
  let noProgress = 0;

  const persist = async () => {
    if (deps.persist) await deps.persist.save(state);
  };
  const fail = async (error: string): Promise<PlanOutcome> => {
    state.status = 'failed';
    await persist();
    return { kind: 'failed', runId, error };
  };
  const killed = async (reason: PlanKillReason): Promise<PlanOutcome> => {
    state.status = 'killed';
    await persist();
    return { kind: 'killed', runId, reason };
  };

  for (let iter = state.transcript.length; ; iter++) {
    if (iter >= ceilings.maxIterations) return await killed('max_iterations');
    if (deps.runner.now() - startedAt > ceilings.maxWallClockMs) return await killed('wall_clock');
    if (tokens > ceilings.maxTokens) return await killed('max_tokens');

    const tools = plan.toolsAllowlist;
    let pick = await deps.planner.pick({
      goal: plan.goal,
      tools,
      transcript: state.transcript,
      scratchpad: state.scratchpad,
      budget: { iterationsLeft: ceilings.maxIterations - iter, tokensLeft: ceilings.maxTokens - tokens },
    });
    if (pick === null) return await fail('planning requires a model');

    // Fail-closed re-validation. An invalid pick → re-prompt ONCE (with the
    // reason as an observation), then fail cleanly on a second invalid pick.
    let v = validatePick(pick, plan, deps.connectors);
    if (!v.ok) {
      state.transcript.push({ idx: idx++, pick: pick as PlanTurn['pick'], observation: cap(`invalid pick: ${v.reason}. Choose a tool from the provisioned surface.`) });
      await persist();
      const retry = await deps.planner.pick({
        goal: plan.goal,
        tools,
        transcript: state.transcript,
        scratchpad: state.scratchpad,
        budget: { iterationsLeft: ceilings.maxIterations - iter, tokensLeft: ceilings.maxTokens - tokens },
      });
      if (retry === null) return await fail('planning requires a model');
      v = validatePick(retry, plan, deps.connectors);
      if (!v.ok) return await fail(`invalid tool pick after re-prompt: ${v.reason}`);
      pick = retry;
    }

    const beforeLen = state.transcript.length;
    const beforeScratch = JSON.stringify(state.scratchpad);

    // ── done ──────────────────────────────────────────────────────────────
    if ('done' in pick && pick.done === true) {
      state.transcript.push({ idx: idx++, pick });
      state.status = 'done';
      state.artifact = pick.artifact;
      await persist();
      return { kind: 'done', runId, artifact: pick.artifact };
    }

    // ── ask_human → needs_input (resumable) ─────────────────────────────────
    if ('ask_human' in pick && pick.ask_human === true) {
      const request: PendingRequest = {
        requestId: newRequestId(),
        kind: pick.kind,
        question: pick.question,
        context: {},
      };
      state.transcript.push({ idx: idx++, pick });
      state.status = 'needs_input';
      state.pending = request;
      await persist();
      return { kind: 'needs_input', runId, request };
    }

    // From here, pick is a {tool, args}.
    const tool = (pick as { tool: string }).tool;
    const args = (pick as { args: Record<string, unknown> }).args ?? {};

    // ── a utility ───────────────────────────────────────────────────────────
    const util = plannerTool(tool);
    if (util) {
      let observation = '';
      if (tool === 'scratchpad.write') {
        state.scratchpad[String(args.key)] = String(args.value);
        observation = `saved "${String(args.key)}"`;
      } else if (tool === 'scratchpad.read') {
        observation = state.scratchpad[String(args.key)] ?? '(empty)';
      } else if (tool === 'memory.retrieve') {
        const k = typeof args.k === 'number' ? args.k : 5;
        observation = deps.utilities?.memoryRetrieve
          ? await deps.utilities.memoryRetrieve(String(args.query), k)
          : 'memory retrieval is unavailable';
      } else if (tool === 'web.search') {
        observation = deps.utilities?.webSearch
          ? await deps.utilities.webSearch(String(args.query))
          : 'web search is unavailable';
      } else if (tool === 'web.fetch') {
        observation = deps.utilities?.webFetch
          ? await deps.utilities.webFetch(String(args.url))
          : 'web fetch is unavailable';
      }
      state.transcript.push({ idx: idx++, pick, observation: cap(observation) });
      noProgress = state.transcript.length > beforeLen || JSON.stringify(state.scratchpad) !== beforeScratch ? 0 : noProgress + 1;
      if (noProgress >= NO_PROGRESS_KILL_AT) return await killed('no_progress');
      await persist();
      continue;
    }

    // ── a connector capability: yield its ProgramStep(s) through dispatchStep ─
    const program = interpretSpec(stepSpecFor(tool, args, plan), deps.connMap, deps.runner.now());
    const gen = program({ nibbin, trigger: { kind: 'user' } });
    let feed: QuarantinedContent | undefined;
    let drafted: { title: string; draft: string; effectArgs: Record<string, unknown>; patternKey: string; connectionId?: string } | null = null;
    let killReason: PlanKillReason | null = null;
    let failError: string | null = null;
    const observations: string[] = [];

    for (;;) {
      const next = await gen.next(feed as QuarantinedContent);
      feed = undefined;
      if (next.done) break;
      const step: ProgramStep = next.value;
      if (idx >= ceilings.maxSteps) { killReason = 'max_steps'; break; }
      const disp = await dispatchStep(step, {
        nibbin, trigger: { kind: 'user' }, runId, idx, tokensSoFar: tokens, ceilings, repetition, deps: deps.runner,
      });
      idx = disp.idxAfter;
      tokens = disp.tokensAfter;
      if (disp.kind === 'kill') { killReason = disp.reason; break; }
      if (disp.kind === 'failed') { failError = disp.error; break; }
      if (disp.kind === 'read_result') {
        feed = disp.feed;
        observations.push(`read ${tool}: ${disp.feed.wrapped}`);
        continue;
      }
      if (disp.kind === 'composed') {
        feed = disp.feed;
        continue;
      }
      if (disp.kind === 'drafted') {
        drafted = {
          title: disp.draft.title,
          draft: disp.draft.draft,
          effectArgs: disp.draft.effectArgs,
          patternKey: disp.draft.patternKey,
          connectionId: disp.draft.connectionId,
        };
        break;
      }
      if (disp.kind === 'executed') {
        // A plan run NEVER auto-executes (student stage drafts everything); this
        // branch is unreachable, but if it ever fired, record it as an effect.
        observations.push(`executed ${disp.effect.capability}`);
        break;
      }
    }

    if (killReason) return await killed(killReason);
    if (failError) return await fail(failError);

    if (drafted) {
      // A side effect was proposed → pause as a resumable needs_input(approval).
      const request: PendingRequest = {
        requestId: newRequestId(),
        kind: 'approval',
        question: drafted.title || `Approve this ${tool}?`,
        context: {
          tool,
          title: drafted.title,
          draft: drafted.draft,
          effectArgs: drafted.effectArgs,
          patternKey: drafted.patternKey,
          connectionId: drafted.connectionId ?? null,
        },
      };
      state.transcript.push({ idx: idx, pick });
      state.status = 'needs_input';
      state.pending = request;
      await persist();
      return { kind: 'needs_input', runId, request };
    }

    const obs = observations.length > 0 ? observations.join('\n') : `ran ${tool}`;
    state.transcript.push({ idx: idx++, pick, observation: cap(obs) });
    noProgress = observations.length > 0 ? 0 : noProgress + 1;
    if (noProgress >= NO_PROGRESS_KILL_AT) return await killed('no_progress');
    await persist();
  }
}
