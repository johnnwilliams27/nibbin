/**
 * Crystallization (Slice 4) — distill a SUCCESSFUL supervised Planner run into a
 * durable, recurring B-spec's executable steps. Pure + unit-testable.
 *
 * The defining property (design §2): the executable `CapabilityStep[]` are
 * extracted DETERMINISTICALLY from the transcript — never re-synthesized by an
 * LLM — so the durable agent is faithful to exactly what the human supervised.
 * A fail-closed gate (design §3) refuses any run that can't safely recur.
 *
 *  - crystallizeTranscript: walk the transcript, collect the connector /
 *    primitive picks in order as CapabilitySteps. A primitive pick maps 1:1 (the
 *    primitive IS the reusable parameterized form). A raw atomic read is kept
 *    only if its path is a reusable listing query (no embedded resource id); a
 *    raw atomic draft/write is never reusable (mirrors validateComposedSpec's
 *    "composed side effects must ride a primitive" rule) → ungeneralizable. A
 *    utility pick in the path → utility_in_path.
 *  - crystallizabilityGate: the fail-closed gate (not_done → no_action →
 *    utility_in_path → branching → ungeneralizable → invalid_spec). Ambiguous →
 *    refuse. The caller adopts ONLY on {ok:true}.
 */
import { capability } from './capabilities';
import { plannerTool } from './utilities';
import { validateComposedSpec } from './validate';
import type {
  AgentSpec,
  CapabilityStep,
  CrystalResult,
  PlanRunState,
  PlanTurn,
} from './types';

/** A turn whose pick is a tool call (not done / not ask_human). */
type ToolPick = { tool: string; args: Record<string, unknown> };

function isToolPick(pick: PlanTurn['pick']): pick is ToolPick {
  return 'tool' in pick && typeof (pick as ToolPick).tool === 'string';
}

function isAskHuman(pick: PlanTurn['pick']): boolean {
  return 'ask_human' in pick && (pick as { ask_human: unknown }).ask_human === true;
}

/**
 * A raw atomic READ path is reusable only if it is a stable LISTING query — no
 * embedded concrete resource id. A path like `/messages?q=is:unread` recurs
 * fine; `/messages/t-1` addresses one run-specific resource derived from a prior
 * observation and cannot generalize. Heuristic, conservative: a path with a
 * non-query segment after the collection (`/coll/<id>`) carries an embedded id.
 */
function readPathEmbedsResourceId(path: unknown): boolean {
  if (typeof path !== 'string' || path.length === 0) return false;
  // Strip the query string; inspect only the path segments.
  const justPath = path.split('?')[0];
  const segments = justPath.split('/').filter((s) => s.length > 0);
  // `/messages` (collection) is fine; `/messages/<id>` (a second segment that is
  // a concrete resource id) is a derived, run-specific address.
  return segments.length >= 2;
}

/**
 * Deterministically extract the executable CapabilityStep[] from a plan run's
 * transcript. Returns the ordered steps, or the FIRST refusal marker
 * (utility_in_path / ungeneralizable). `done`/`ask_human` turns are ignored for
 * step extraction (the gate inspects them separately).
 */
export function crystallizeTranscript(planRun: PlanRunState): CrystalResult {
  const steps: CapabilityStep[] = [];
  for (const turn of planRun.transcript) {
    const pick = turn.pick;
    if (!isToolPick(pick)) continue; // done / ask_human — not a step
    const tool = pick.tool;
    const args = (pick.args ?? {}) as Record<string, unknown>;

    // A utility pick is a runtime-reasoning aid, never a B-step.
    if (plannerTool(tool)) {
      return { ok: false, reason: 'utility_in_path', detail: `utility "${tool}" is not a reusable step` };
    }

    const cap = capability(tool);
    if (!cap) {
      // An unknown id can't be reduced to a reusable step.
      return { ok: false, reason: 'ungeneralizable', detail: `"${tool}" is not a registry capability` };
    }

    if (cap.kind === 'primitive') {
      // The primitive IS the reusable, parameterized form — args are its typed
      // params (validateComposedSpec re-checks them against the inputSchema).
      steps.push({ capability: tool, inputs: args });
      continue;
    }

    // A raw atomic draft/write is not a reusable step — reuse must ride a
    // primitive that owns its effectArgs (mirrors validateComposedSpec).
    if (cap.sideEffect === 'draft' || cap.sideEffect === 'write') {
      return {
        ok: false,
        reason: 'ungeneralizable',
        detail: `raw ${cap.sideEffect} "${tool}" must ride a primitive — a bespoke one-off ${cap.sideEffect} is not reusable`,
      };
    }

    // A raw atomic read — keep it only if the path is a reusable listing query
    // (no embedded run-specific resource id).
    const path = args.path;
    if (readPathEmbedsResourceId(path)) {
      return {
        ok: false,
        reason: 'ungeneralizable',
        detail: `read path "${String(path)}" embeds a run-specific resource id — not reusable`,
      };
    }
    steps.push({ capability: tool, inputs: { path } });
  }
  return { ok: true, steps };
}

/** Does an extracted step perform an approved connector ACTION (a draft/write),
 *  not a pure read? A draft-producing primitive counts; a presentation/read-only
 *  digest (sideEffect 'read') does not. */
function stepIsAction(step: CapabilityStep): boolean {
  const cap = capability(step.capability);
  if (!cap) return false;
  if (cap.sideEffect === 'draft' || cap.sideEffect === 'write') return true;
  // A primitive whose effectiveTools include a draft/write tool produces an
  // approved connector action (e.g. a nudge drafts an email). A read-only digest
  // primitive's effectiveTools are all reads → no action.
  if (cap.kind === 'primitive') {
    return (cap.effectiveTools ?? []).some((t) => {
      const dep = capability(t);
      return dep?.sideEffect === 'draft' || dep?.sideEffect === 'write';
    });
  }
  return false;
}

/**
 * Detect an observation-dependent branching signal the linear extract can't
 * represent (design §3.3). Conservative for this slice: an atomic READ pick
 * whose path embeds a concrete resource id (a `/coll/<id>` shape) was derived
 * from a prior observation in a non-reproducible way → branching. (A single
 * primitive, or a fixed listing-read → draft pair, is linear.)
 */
function hasBranchingSignal(planRun: PlanRunState): boolean {
  for (const turn of planRun.transcript) {
    const pick = turn.pick;
    if (!isToolPick(pick)) continue;
    const cap = capability(pick.tool);
    if (cap && cap.kind !== 'primitive' && cap.sideEffect === 'read') {
      if (readPathEmbedsResourceId((pick.args ?? {}).path)) return true;
    }
  }
  return false;
}

/** The probe AgentSpec the gate builds from the extracted steps to run through
 *  the EXISTING validateComposedSpec (the same fail-closed check adoption uses).
 *  Trusted fields are derived from the steps server-side, never from an LLM. */
function probeSpec(steps: CapabilityStep[]): AgentSpec {
  const tools = new Set<string>();
  const connectors = new Set<string>();
  for (const step of steps) {
    const cap = capability(step.capability);
    if (!cap) continue;
    const effective = cap.effectiveTools && cap.effectiveTools.length > 0 ? cap.effectiveTools : [cap.id];
    for (const t of effective) {
      tools.add(t);
      const dep = capability(t);
      if (dep) connectors.add(dep.requiredConnector);
    }
    if (connectors.size === 0) connectors.add(cap.requiredConnector);
  }
  return {
    templateKey: null,
    version: 1,
    displayName: 'Crystallized agent',
    toolsAllowlist: [...tools],
    requiredConnectors: [...connectors],
    // A manual trigger is always valid; the real trigger is the user's choice at
    // adopt time. The probe only needs to validate the steps + connectors.
    triggers: [{ kind: 'user' }],
    curriculum: {
      measures: 'crystallized drafts approved without edits',
      promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95, coverageMinPatterns: 4 },
      routineMinApprovals: 5,
    },
    creditProfile: { weightClass: 'standard', ceilings: { maxSteps: 120, maxTokens: 12_000, maxWallClockMs: 60_000 } },
    steps,
  };
}

/**
 * The fail-closed crystallizability gate (design §3). Refuse, in order:
 *  1. status !== 'done' → not_done
 *  2. no approved connector action (read-only/research) → no_action
 *  3. any utility / ask_human in the load-bearing path → utility_in_path
 *  4. an observation-dependent branching signal → branching
 *  5. crystallizeTranscript's ungeneralizable marker → ungeneralizable
 *  6. validateComposedSpec on the probe spec → invalid_spec
 * Else {ok:true, steps}. Ambiguous → refuse.
 */
export function crystallizabilityGate(planRun: PlanRunState, accountConnections: string[]): CrystalResult {
  // (1) reached `done`.
  if (planRun.status !== 'done') {
    return { ok: false, reason: 'not_done', detail: `run status is "${planRun.status}", not "done"` };
  }

  // (3a — checked before the extract so a utility/ask_human refuses as itself,
  // not as no_action): any utility pick or ask_human in the path needed live
  // runtime judgment → not a recurring chore.
  for (const turn of planRun.transcript) {
    if (isAskHuman(turn.pick)) {
      return { ok: false, reason: 'utility_in_path', detail: 'run asked the human mid-task (needed live judgment)' };
    }
    if (isToolPick(turn.pick) && plannerTool(turn.pick.tool)) {
      return { ok: false, reason: 'utility_in_path', detail: `utility "${turn.pick.tool}" is a runtime-reasoning aid, not a B-step` };
    }
  }

  // (4) branching: an atomic read whose path was derived from a prior observation.
  if (hasBranchingSignal(planRun)) {
    return { ok: false, reason: 'branching', detail: 'a read path was derived from a prior observation — the linear extract cannot reproduce it' };
  }

  // (5) deterministic extract → propagate ungeneralizable (utility already caught above).
  const extracted = crystallizeTranscript(planRun);
  if (!extracted.ok) return extracted;
  const steps = extracted.steps;

  // (2) at least one approved connector action (a draft/effect), not a pure read.
  if (steps.length === 0 || !steps.some(stepIsAction)) {
    return { ok: false, reason: 'no_action', detail: 'the run produced no approved connector action — a read-only/research run is better re-run on demand' };
  }

  // (6) the extracted steps must validate under the EXISTING composed-spec gate.
  const problems = validateComposedSpec(probeSpec(steps), accountConnections);
  if (problems.length > 0) {
    return { ok: false, reason: 'invalid_spec', detail: problems.join('; ') };
  }

  return { ok: true, steps };
}
