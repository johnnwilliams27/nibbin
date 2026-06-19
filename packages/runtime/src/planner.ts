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
import { dispatchStep, hashArgs, REPETITION_KILL_AT, type RunnerDeps } from './runner';
import { interpretSpec } from './interpreter';
import { validatePick, type PlannerPickInput } from './validate';
import {
  assertSafeNavigateUrl,
  describeTarget,
  validateComputerUseArgs,
  type BrowserDriver,
  type ComputerUseVerb,
} from './browser';
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
  /**
   * The computer_use (browser) driver. Absent → a computer_use pick returns a
   * clean "unavailable" observation (it never throws into the loop). The
   * injected `isPublicIp` is the connectors-package predicate the navigate SSRF
   * guard uses (the runtime stays pure — apps/web passes @nibbin/connectors).
   */
  browser?: BrowserDriver;
  /** Public-IP predicate for the navigate SSRF guard (apps/web → connectors). */
  isPublicIp?: (addr: string) => boolean;
  /** Persist the run state on each pause/checkpoint (Task 3). */
  persist?: PlanRunPersist;
  /** Injectable id factory (tests). */
  newRunId?: () => string;
  newRequestId?: () => string;
}

/** Consecutive no-observation/no-scratchpad-change iterations before a no-progress kill. */
export const NO_PROGRESS_KILL_AT = 3;

/** Per-run cap on web egress (web.search + web.fetch). Provider spend is bounded
 *  by design, not incidentally by the token budget (design §7). A web call past
 *  the cap does NOT egress — it returns a quarantined "budget exhausted" obs. */
export const MAX_WEB_CALLS = 4;

/** The egressing utility ids (web.*) — counted against MAX_WEB_CALLS. */
const WEB_UTILITY_IDS: ReadonlySet<string> = new Set(['web.search', 'web.fetch']);

/** Longest observation we keep in the transcript (mirrors the read quarantine cap). */
const OBSERVATION_MAX_CHARS = 4000;

function cap(text: string, max = OBSERVATION_MAX_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
}

/** The most recent utility turn's observation (for the no-progress comparison —
 *  a utility pick that yields the same observation as the last one is not
 *  progress). Returns undefined when there is no prior utility turn. */
function lastUtilityObservation(transcript: PlanTurn[]): string | undefined {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const t = transcript[i];
    if ('tool' in t.pick && typeof t.pick.tool === 'string' && plannerTool(t.pick.tool)) {
      return t.observation;
    }
  }
  return undefined;
}

/** The most recent computer_use (browser) turn's observation — the no-progress
 *  baseline for the CU read path. `lastUtilityObservation` only matches UTILITY
 *  picks, so a browser-only loop would never trip no-progress against it; this
 *  compares a CU read to the prior CU read so distinct-but-unproductive browser
 *  churn (e.g. scrolling at the page bottom, or re-extracting content that keeps
 *  returning the same text) trips NO_PROGRESS_KILL_AT before exhausting
 *  maxIterations. */
function lastBrowserObservation(transcript: PlanTurn[]): string | undefined {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const t = transcript[i];
    if ('tool' in t.pick && typeof t.pick.tool === 'string' && capability(t.pick.tool)?.family === 'computer_use') {
      return t.observation;
    }
  }
  return undefined;
}

/** A quarantine wrap carries a per-wrap RANDOM tag, so two reads of the SAME
 *  page text are never byte-identical. For the no-progress comparison we
 *  normalize the random tag out, so "same page text" reads compare equal (and
 *  thus count as no progress) even though their wrappers differ. */
function normalizeBrowserObservation(obs: string | undefined): string | undefined {
  return obs?.replace(/:[0-9a-f]{24}\b/g, ':<tag>');
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

/**
 * Replay each resumed connector turn through the SAME interpreter program the
 * live loop runs (interpretSpec ∘ stepSpecFor) and increment the repetition map
 * for every `read` step it yields, keyed `read:<capability>:<hashArgs(path)>` —
 * byte-for-byte the key dispatchStep uses live (runner.ts). This makes a resumed
 * run's repetition state faithful to a non-resumed run for BOTH atomic reads and
 * primitives (whose internal reads were previously dropped on resume). Feed is
 * undefined: the deterministic, feed-independent reads (the ones that recur when
 * the same pick repeats, e.g. a mailbox list sweep) are reached; feed-dependent
 * per-record reads are unique and never the repetition driver.
 *
 * Defensive: a primitive impl can throw (missing connection, etc.). A resume
 * must never fail because the rebuild couldn't replay a turn — on any throw we
 * stop draining THAT turn (its counted reads so far stand) and move on; the
 * live loop will re-validate + re-dispatch the next pick under the real gates.
 */
async function rebuildReadRepetition(
  transcript: PlanTurn[],
  plan: PlanSpec,
  connMap: Record<string, string | undefined>,
  nowMs: number,
  repetition: Map<string, number>,
  nibbin: NibbinRef,
): Promise<void> {
  for (const t of transcript) {
    if (!('tool' in t.pick) || typeof t.pick.tool !== 'string') continue;
    const tool = t.pick.tool;
    // Only connector capabilities reach the interpreter; utilities/sentinels are
    // primed elsewhere (and have no capability descriptor). A computer_use verb
    // is NOT a connector capability (driven by the BrowserDriver, no interpreter
    // program) — primed by the `cu:` key loop, skipped here.
    const desc = capability(tool);
    if (plannerTool(tool) || !desc || desc.family === 'computer_use') continue;
    const args = (t.pick as { args?: Record<string, unknown> }).args ?? {};
    try {
      const program = interpretSpec(stepSpecFor(tool, args, plan), connMap, nowMs);
      const gen = program({ nibbin, trigger: { kind: 'user' } });
      for (;;) {
        const next = await gen.next(undefined);
        if (next.done) break;
        const step = next.value;
        if (step.kind === 'read') {
          const repKey = `read:${step.capability}:${hashArgs(step.path)}`;
          repetition.set(repKey, (repetition.get(repKey) ?? 0) + 1);
        }
      }
    } catch {
      // see doc comment — a failed replay of one turn must not abort the resume.
    }
  }
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
  const startedAt = deps.runner.now();
  const repetition = new Map<string, number>();
  // Rebuild the repetition map from the resumed transcript so a resumed loop
  // can't bypass the repetition kill by forgetting prior moves.
  //
  // A connector pick (atomic read OR primitive) is counted EXACTLY as the live
  // loop counts it: dispatchStep keys repetition on each `read` step it gates,
  // as `read:<capability>:<hashArgs(path)>` (runner.ts). So we replay the same
  // interpreter program the live loop runs (interpretSpec ∘ stepSpecFor) and
  // increment the same key for every `read` step it yields. This restores a
  // primitive's INTERNAL read counts across a resume — the old rebuild filtered
  // primitives out (`c.kind !== 'primitive'`), so a primitive repeated across a
  // resume could exceed REPETITION_KILL_AT without being killed. Replaying with
  // an undefined feed reaches the deterministic, feed-independent reads (e.g. a
  // primitive's mailbox-list sweep) — exactly the reads that accumulate to the
  // kill when the same primitive is picked again; per-message meta reads are
  // unique and never the repetition driver, so not reaching them is faithful.
  await rebuildReadRepetition(state.transcript, plan, deps.connMap, startedAt, repetition, nibbin);
  // Prime the utility repetition map + the web-egress counter from the resumed
  // transcript so a resumed loop can't bypass either guard by forgetting prior
  // utility calls (especially repeated web.* egress).
  let webCalls = 0;
  for (const t of state.transcript) {
    if (!('tool' in t.pick) || typeof t.pick.tool !== 'string') continue;
    const tool = t.pick.tool;
    const args = (t.pick as { args: Record<string, unknown> }).args ?? {};
    if (plannerTool(tool)) {
      const repKey = `util:${tool}:${hashArgs(args)}`;
      repetition.set(repKey, (repetition.get(repKey) ?? 0) + 1);
      if (WEB_UTILITY_IDS.has(tool)) webCalls += 1;
    } else if (capability(tool)?.family === 'computer_use') {
      // Prime the computer_use repetition key so a resumed loop can't bypass the
      // repetition kill by forgetting prior browser picks (mirrors util:/read:).
      const repKey = `cu:${tool}:${hashArgs(args)}`;
      repetition.set(repKey, (repetition.get(repKey) ?? 0) + 1);
    }
  }
  let idx = state.transcript.length;
  let tokens = 0;
  let noProgress = 0;

  const persist = async () => {
    if (deps.persist) await deps.persist.save(state);
  };
  const fail = async (error: string): Promise<PlanOutcome> => {
    state.status = 'failed';
    // FIX 11: persist the real terminal error so an idempotent re-read echoes
    // the true reason, not a hardcoded placeholder.
    state.artifact = { terminal: 'failed', error };
    await persist();
    return { kind: 'failed', runId, error };
  };
  const killed = async (reason: PlanKillReason): Promise<PlanOutcome> => {
    state.status = 'killed';
    // FIX 11: persist the real kill reason for the idempotent re-read.
    state.artifact = { terminal: 'killed', reason };
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
      // FIX 6: a pick can arrive in the TOOL shape for done/ask_human (the
      // model emitted {"tool":"done",...} instead of the flag-shape). Normalize
      // it to the sentinel handling so a genuine finish/escalation is never
      // silently dropped (it would otherwise fall through with an empty obs and
      // the run would die at max_iterations).
      if (tool === 'done') {
        const artifact = (args.artifact ?? args.summary ?? args) as unknown;
        state.transcript.push({ idx: idx++, pick });
        state.status = 'done';
        state.artifact = artifact;
        await persist();
        return { kind: 'done', runId, artifact };
      }
      if (tool === 'ask_human') {
        const kind = (args.kind === 'auth' || args.kind === 'decision' || args.kind === 'value')
          ? args.kind
          : 'decision';
        const question = typeof args.question === 'string' && args.question.trim() !== ''
          ? args.question
          : 'I need your input.';
        const request: PendingRequest = { requestId: newRequestId(), kind, question, context: {} };
        state.transcript.push({ idx: idx++, pick });
        state.status = 'needs_input';
        state.pending = request;
        await persist();
        return { kind: 'needs_input', runId, request };
      }

      // FIX 5/7: repetition guard for utilities keyed on (tool, hashArgs(args))
      // — a picker can't spin on the same scratchpad.read or web.search. Web
      // egress is additionally bounded per-run by MAX_WEB_CALLS (FIX 7).
      const repKey = `util:${tool}:${hashArgs(args)}`;
      const seen = (repetition.get(repKey) ?? 0) + 1;
      repetition.set(repKey, seen);
      if (seen >= REPETITION_KILL_AT) return await killed('repetition');

      let observation = '';
      let progressed = false; // a non-empty, non-identical observation = progress
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
        if (webCalls >= MAX_WEB_CALLS) {
          observation = 'web budget exhausted for this run — no further web calls';
        } else {
          webCalls += 1;
          observation = deps.utilities?.webSearch
            ? await deps.utilities.webSearch(String(args.query))
            : 'web search is unavailable';
        }
      } else if (tool === 'web.fetch') {
        if (webCalls >= MAX_WEB_CALLS) {
          observation = 'web budget exhausted for this run — no further web calls';
        } else {
          webCalls += 1;
          observation = deps.utilities?.webFetch
            ? await deps.utilities.webFetch(String(args.url))
            : 'web fetch is unavailable';
        }
      }

      // FIX 5: real progress for the utility branch — the scratchpad changed,
      // OR a non-empty observation that differs from the immediately-prior
      // utility observation. (The old `transcript.length > beforeLen` was always
      // true after the push, so noProgress never incremented for utilities.)
      const scratchChanged = JSON.stringify(state.scratchpad) !== beforeScratch;
      const priorUtilObs = lastUtilityObservation(state.transcript);
      const obsIsProgress = observation.trim() !== '' && observation !== priorUtilObs;
      progressed = scratchChanged || obsIsProgress;

      state.transcript.push({ idx: idx++, pick, observation: cap(observation) });
      noProgress = progressed ? 0 : noProgress + 1;
      if (noProgress >= NO_PROGRESS_KILL_AT) return await killed('no_progress');
      await persist();
      continue;
    }

    // ── a computer_use (browser) verb ────────────────────────────────────────
    // The verb was already validated fail-closed by validatePick (verb ∈ surface
    // + target schema). reads (navigate/extract/screenshot/scroll) → quarantined
    // observation, surfaced as DATA. writes (click/type) → pause as a resumable
    // needs_input(approval); the driver NEVER auto-commits — apps/web replays the
    // verb via driver.commit() only after the human approves (the same approval
    // gate the connector-draft path uses). Bounded by the same repetition guard.
    const cuCap = capability(tool);
    if (cuCap?.family === 'computer_use') {
      const verb = cuCap.verb as ComputerUseVerb;
      // Repetition guard keyed on (tool, args) — same as utilities, so a picker
      // can't spin on the same navigate/extract.
      const repKey = `cu:${tool}:${hashArgs(args)}`;
      const seen = (repetition.get(repKey) ?? 0) + 1;
      repetition.set(repKey, seen);
      if (seen >= REPETITION_KILL_AT) return await killed('repetition');

      // Re-derive the validated args (validatePick already accepted them).
      let cu;
      try {
        cu = validateComputerUseArgs(verb, args);
      } catch (err) {
        // Should be unreachable (validatePick gates this) — fail cleanly.
        return await fail(`invalid computer_use args: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (!deps.browser) {
        state.transcript.push({ idx: idx++, pick, observation: cap('the browser is unavailable for this run') });
        noProgress += 1;
        if (noProgress >= NO_PROGRESS_KILL_AT) return await killed('no_progress');
        await persist();
        continue;
      }

      // ── WRITE verbs (click/type): pause for approval; commit NOTHING now ─────
      if (cu.verb === 'click' || cu.verb === 'type') {
        const draftResult =
          cu.verb === 'click'
            ? await deps.browser.click(cu.target)
            : await deps.browser.type(cu.target, cu.value);
        const request: PendingRequest = {
          requestId: newRequestId(),
          kind: 'approval',
          question: `Approve browser action: ${draftResult.summary}?`,
          context: {
            tool,
            computerUse: {
              verb: cu.verb,
              target: cu.target,
              ...(cu.verb === 'type' ? { value: cu.value } : {}),
            },
            summary: draftResult.summary,
          },
        };
        state.transcript.push({ idx: idx++, pick });
        state.status = 'needs_input';
        state.pending = request;
        await persist();
        return { kind: 'needs_input', runId, request };
      }

      // ── READ verbs (navigate/extract/screenshot/scroll): quarantined obs ─────
      let result;
      try {
        if (cu.verb === 'navigate') {
          // SSRF guard — the SAME literal-host check web.fetch applies (private/
          // loopback/metadata rejected). The Playwright adapter additionally
          // routes egress through safeFetch's resolve+pin rebind defense AND a
          // per-request Chromium interceptor.
          //
          // FAIL-CLOSED default (P2): a security guard must NOT default to
          // allow-all. With a live browser driver present, `isPublicIp` is
          // REQUIRED — its absence is a misconfiguration, so we use a deny-all
          // predicate (every literal IP is treated as non-public). apps/web always
          // injects the connectors predicate; this only bites a misconfigured wiring.
          assertSafeNavigateUrl(cu.url, deps.isPublicIp ?? (() => false));
          result = await deps.browser.navigate(cu.url);
        } else if (cu.verb === 'extract') {
          result = await deps.browser.extract(cu.target);
        } else if (cu.verb === 'screenshot') {
          result = await deps.browser.screenshot(cu.target);
        } else {
          result = await deps.browser.scroll(cu.target);
        }
      } catch (err) {
        // A blocked navigate (SSRF) or a driver error → a clean quarantined-shaped
        // observation; never throw into the loop.
        const why = err instanceof Error ? err.message : String(err);
        const tgt = cu.verb === 'navigate' ? cu.url : describeTarget(cu.target ?? {});
        state.transcript.push({ idx: idx++, pick, observation: cap(`${cu.verb} (${tgt}) was rejected: ${why}`) });
        noProgress += 1;
        if (noProgress >= NO_PROGRESS_KILL_AT) return await killed('no_progress');
        await persist();
        continue;
      }

      const observation = `${cu.verb}: ${result.content.wrapped}`;
      // No-progress baseline for the CU read path: compare against the prior
      // BROWSER observation (not the prior utility one) so a browser-only loop
      // can trip no-progress (FIX P3). The random quarantine tag is normalized
      // out so the comparison is on the page CONTENT, not the per-wrap tag —
      // otherwise two reads of the same page text would always look "different".
      const priorBrowserObs = normalizeBrowserObservation(lastBrowserObservation(state.transcript));
      const progressed = observation.trim() !== '' && normalizeBrowserObservation(observation) !== priorBrowserObs;
      state.transcript.push({ idx: idx++, pick, observation: cap(observation) });
      noProgress = progressed ? 0 : noProgress + 1;
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
