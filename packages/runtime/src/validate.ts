/**
 * Spec validation — SPEC §6.2: "cycle-checked trigger graphs at
 * spec-validation time", §4.6: "custom specs pass the same trigger-graph and
 * tool-allowlist validation as shop specs".
 *
 * The Grovekeeper is a structurally terminal hub (§4.2 hard rule 3): it is a
 * sink for events and a source only for user-initiated or scheduled
 * dispatches. Nothing here can express "a specialist event triggers the
 * Keeper" — such specs are rejected, not gated.
 */
import { CONNECTOR_REGISTRY, capabilityCanSend } from '@nibbin/connectors';
import { capability, isComputerUseCapability } from './capabilities';
import { assertSafeReadPath, resolvePrimitiveInputs } from './interpreter';
import {
  COMPUTER_USE_CEILINGS,
  isComputerUseVerb,
  validateComputerUseArgs,
  type ComputerUseVerb,
} from './browser';
import { plannerTool, EGRESS_UTILITY_IDS } from './utilities';
import type { AgentSpec, PlanSpec, PlannerTool, TriggerDef } from './types';

export const KEEPER_NODE = 'keeper';

/**
 * Hard cap on the number of primitive steps a composed spec may carry (Part A —
 * multi-primitive composition). A composed Nibbin is a small, legible agent: a
 * handful of ordered primitives, not an unbounded pipeline. The Composer never
 * proposes more than this, and a user-edited spec that exceeds it is rejected
 * fail-closed at adopt time. The bound is load-bearing for legibility + cost
 * (each step is its own gated read/draft sequence), so it is a structural check.
 */
export const MAX_COMPOSED_STEPS = 4;

const EVENT_SOURCE = /^(connector|nibbin):[a-z0-9-]+(:[a-z0-9._-]+)?$/;
const SCHEDULE_KEY = /^[a-z]+(\.[a-z0-9_-]+)?$/;

/** Capabilities every registry connector declares, as one lookup set. */
function registryCapabilities(): Set<string> {
  const caps = new Set<string>();
  for (const d of CONNECTOR_REGISTRY.values()) {
    for (const c of d.capabilities) caps.add(c);
  }
  return caps;
}

/**
 * Validate one spec in isolation: tool allowlist against the connector
 * registry, required connectors exist, trigger shapes well-formed, Keeper
 * rules. Returns problems (empty = valid).
 */
export function validateSpec(spec: AgentSpec): string[] {
  const problems: string[] = [];
  const at = (msg: string) => problems.push(`${spec.templateKey ?? spec.displayName}: ${msg}`);

  if (!spec.displayName.trim()) at('display name required');
  if (!Number.isInteger(spec.version) || spec.version < 1) at('version must be a positive integer');

  if (spec.templateKey === KEEPER_NODE) {
    at('the Grovekeeper is not an adoptable spec (C10: it has no hands, permanently)');
  }

  const caps = registryCapabilities();
  if (spec.toolsAllowlist.length === 0) at('tool allowlist must not be empty');
  for (const tool of spec.toolsAllowlist) {
    if (!caps.has(tool)) at(`tool "${tool}" is not a registry capability`);
  }

  if (spec.requiredConnectors.length === 0) at('at least one required connector');
  for (const provider of spec.requiredConnectors) {
    if (!CONNECTOR_REGISTRY.has(provider)) at(`unknown connector "${provider}"`);
  }
  // every tool must be powered by at least one required connector
  for (const tool of spec.toolsAllowlist) {
    const powered = spec.requiredConnectors.some((p) =>
      CONNECTOR_REGISTRY.get(p)?.capabilities.includes(tool),
    );
    if (powered === false && caps.has(tool)) {
      at(`tool "${tool}" is not powered by any required connector`);
    }
  }
  // send-capable tools must ride a connector that declares velocity caps
  for (const tool of spec.toolsAllowlist) {
    if (!capabilityCanSend(tool)) continue;
    const capped = spec.requiredConnectors.some((p) => {
      const d = CONNECTOR_REGISTRY.get(p);
      return d?.capabilities.includes(tool) && d.send !== undefined;
    });
    if (!capped) at(`send-capable tool "${tool}" has no velocity-capped connector (RISKS §2)`);
  }

  if (spec.triggers.length === 0) at('at least one trigger');
  for (const t of spec.triggers) problems.push(...validateTrigger(spec, t));

  const { windowRuns, minApprovedUneditedPct } = spec.curriculum.promotion;
  if (windowRuns < 25) at('promotion window may not drop below 25 runs (§4.7)');
  if (minApprovedUneditedPct < 0.95) at('promotion threshold may not drop below 95% (§4.7)');
  if (spec.curriculum.routineMinApprovals < 1) at('routineMinApprovals must be >= 1');

  const c = spec.creditProfile.ceilings;
  if (c.maxSteps < 1 || c.maxTokens < 0 || c.maxWallClockMs < 1) {
    at('per-run ceilings must be positive (§6.2)');
  }

  return problems;
}

function validateTrigger(spec: AgentSpec, t: TriggerDef): string[] {
  const problems: string[] = [];
  const at = (msg: string) => problems.push(`${spec.templateKey ?? spec.displayName}: ${msg}`);

  if (t.kind === 'event') {
    if (!t.source || !EVENT_SOURCE.test(t.source)) {
      at(`event trigger needs a well-formed source, got "${t.source ?? ''}"`);
      return problems;
    }
    const [origin, key] = t.source.split(':');
    if (origin === 'nibbin' && key === KEEPER_NODE) {
      // §4.2: the Keeper is a sink. Specialist work flows TO it, never from it
      // as an event source — delegation rides user-initiated dispatches only.
      at('the Grovekeeper can never be an event source (terminal hub, §4.2)');
    }
    if (origin === 'connector' && !CONNECTOR_REGISTRY.has(key!)) {
      at(`event trigger references unknown connector "${key}"`);
    }
  } else if (t.kind === 'schedule') {
    if (!t.schedule || !SCHEDULE_KEY.test(t.schedule)) {
      at(`schedule trigger needs a named cadence, got "${t.schedule ?? ''}"`);
    }
  }
  if (t.debounceSecs !== undefined && t.debounceSecs < 0) at('debounceSecs must be >= 0');
  if (t.cooldownSecs !== undefined && t.cooldownSecs < 0) at('cooldownSecs must be >= 0');
  return problems;
}

/**
 * Cycle check across an account's full spec set (§6.2; §7.3 suite).
 *
 * Nodes are template keys (custom specs use their display name); an edge
 * A → B exists when B listens for `nibbin:A:*` events. Any cycle — including
 * a self-loop — rejects the WHOLE set: Nibbins must never trigger each other
 * cyclically. The Keeper is added as an implicit node that may receive
 * everything and source nothing.
 */
export function validateTriggerGraph(specs: AgentSpec[]): string[] {
  const problems: string[] = [];

  for (const spec of specs) problems.push(...validateSpec(spec));

  const nodeFor = (s: AgentSpec) => s.templateKey ?? s.displayName;
  const nodes = new Set(specs.map(nodeFor));

  // adjacency: emitter -> listeners
  const edges = new Map<string, Set<string>>();
  for (const spec of specs) {
    for (const t of spec.triggers) {
      if (t.kind !== 'event' || !t.source) continue;
      const [origin, emitter] = t.source.split(':');
      if (origin !== 'nibbin' || emitter === undefined) continue;
      if (emitter === KEEPER_NODE) continue; // already rejected per-spec
      if (!nodes.has(emitter)) {
        // listening to a Nibbin that isn't in the set is fine (not adopted yet)
        continue;
      }
      const set = edges.get(emitter) ?? new Set<string>();
      set.add(nodeFor(spec));
      edges.set(emitter, set);
    }
  }

  // DFS cycle detection
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];

  const visit = (node: string): string[] | null => {
    color.set(node, GREY);
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GREY) return [...stack.slice(stack.indexOf(next)), next];
      if (c === WHITE) {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return null;
  };

  for (const node of nodes) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      const cycle = visit(node);
      if (cycle) {
        problems.push(`trigger cycle rejected: ${cycle.join(' → ')} (§6.2: Nibbins must never trigger each other cyclically)`);
        break;
      }
    }
  }

  return problems;
}

/**
 * Fail-closed gate for a SYNTHESIZED spec (design §2.4) — the trust boundary
 * between the untrusted Composer and adoption. Returns problems (empty = ok);
 * the caller adopts ONLY when the list is empty. Every check must pass:
 *
 *  - the base spec is valid (validateSpec via validateTriggerGraph): allowlist
 *    powered by connectors, triggers well-formed, Keeper rules, promotion
 *    floors, positive ceilings;
 *  - the trigger graph across the account's existing specs + this one is
 *    acyclic (no Nibbin-triggers-Nibbin cycle, §6.2);
 *  - (multi-primitive, Part A) the spec carries at most MAX_COMPOSED_STEPS
 *    steps, and no two steps are byte-identical (same capability + same inputs);
 *  - every `step.capability` is a CAPABILITY_REGISTRY id;
 *  - every step's capability is in `toolsAllowlist` (so the runner's allowlist
 *    gate admits it — a step the allowlist would kill is rejected here);
 *  - a composed `draft`/`write` step MUST be a primitive (kind==='primitive'):
 *    a raw atomic draft/write step would carry attacker-shaped effectArgs from
 *    `step.inputs`, so composed side effects must ride a primitive that builds
 *    its own effectArgs;
 *  - every primitive step's `inputs` match the primitive's inputSchema
 *    (types/bounds, no unknown keys) — `resolvePrimitiveInputs` is the single
 *    source of that check, shared with the interpreter;
 *  - every `requiredConnector` is in `accountConnections` (granted/active);
 *  - (defense-in-depth, should be moot — primitives own paths/effectArgs) an
 *    ATOMIC read step's `inputs.path` is connector-relative (no scheme,
 *    no '..', slash-rooted): the same SSRF/traversal guard the interpreter
 *    applies at run time, applied here so an invalid one never adopts.
 *
 * The LLM only ever picks a primitive id + schema-checked scalar params; this
 * function is what makes that structurally safe.
 */
export function validateComposedSpec(spec: AgentSpec, accountConnections: string[], existing: AgentSpec[] = []): string[] {
  const problems: string[] = [];
  const at = (msg: string) => problems.push(`${spec.displayName}: ${msg}`);

  // Base spec + cross-account cycle check (reuses the shop-spec validation).
  problems.push(...validateTriggerGraph([...existing, spec]));

  const granted = new Set(accountConnections);
  for (const provider of spec.requiredConnectors) {
    if (!granted.has(provider)) at(`required connector "${provider}" is not connected on this account`);
  }

  const allowlist = new Set(spec.toolsAllowlist);
  const steps = spec.steps ?? [];
  if (steps.length === 0) at('a composed spec must have at least one step');

  // Cross-step structural checks (Part A — multi-primitive). The interpreter
  // runs steps[] linearly, so a multi-primitive spec is safe per-step; these
  // bound the SHAPE: a composed Nibbin stays a small ordered handful, and the
  // exact same step is never run twice (a duplicate is either Composer noise or
  // a user double-add — never intentional, and it would double-draft).
  if (steps.length > MAX_COMPOSED_STEPS) {
    at(`a composed spec may have at most ${MAX_COMPOSED_STEPS} steps, got ${steps.length}`);
  }
  const seen = new Set<string>();
  let dupIdx = -1;
  for (const step of steps) {
    dupIdx += 1;
    // Identity = capability id + its bound inputs (order-independent JSON). Two
    // steps that differ only in params are allowed (e.g. two nudges at different
    // staleDays); a byte-identical repeat is rejected.
    const key = `${step.capability}::${stableStringify(step.inputs ?? {})}`;
    if (seen.has(key)) {
      at(`step ${dupIdx} is a duplicate of an earlier identical step "${step.capability}" — remove the repeat`);
    }
    seen.add(key);
  }

  // FIX 1 (red-team P2): the FULL connector union across every step, derived
  // server-side from each step's effectiveTools → home connectors (NEVER from
  // LLM output). The per-step `cap.requiredConnector` check below only sees each
  // capability's HOME connector; a cross-resource primitive (e.g.
  // nudge.unconfirmed-event homed on google-calendar but drafting on gmail via
  // email.send) touches connectors its home alone doesn't name. We accumulate
  // the union here and, after the loop, assert it is BOTH ⊆ granted AND fully
  // listed in spec.requiredConnectors — so a raw-spec path (adoptSynthesized
  // with edit undefined) can never omit a non-home connector from
  // requiredConnectors and slip through on an account missing it. Reuses
  // `uniqueConnectorsFor` (the same registry tool→connector mapping validateSpec
  // and validatePlanSpec use) — do not reimplement divergently.
  const derivedConnectors = new Set<string>();

  let idx = -1;
  for (const step of steps) {
    idx += 1;
    const cap = capability(step.capability);
    if (!cap) {
      at(`step ${idx} capability "${step.capability}" is not a registry capability`);
      continue;
    }

    // FIX 2 (red-team P3): every composed step's capability must be a primitive
    // OR a pure read — asserted by KIND, not merely by the draft/write branch
    // below. The interpreter's generic non-primitive draft/write path reads
    // effectArgs straight from `step.inputs`; for composed specs it is
    // unreachable ONLY because the draft/write branch below rejects atomic
    // side-effecting steps. Asserting kind-or-read here is the load-bearing
    // guard: a capability mis-tagged off `'primitive'` (or a future atomic
    // side-effecting cap) can never reopen raw-effectArgs injection, regardless
    // of what the draft/write branch does. A pure read (sideEffect==='read') is
    // safe — it carries no effectArgs, only a path the read-path guard checks.
    if (cap.kind !== 'primitive' && cap.sideEffect !== 'read') {
      at(
        `step ${idx} capability "${cap.id}" is a ${cap.sideEffect} step that is not a primitive — every composed step must be a primitive or a read (composed side effects must ride a primitive that owns its effectArgs)`,
      );
    }

    // FIX 1: contribute this step's connectors to the union. For a primitive,
    // its effectiveTools map to the real connectors it touches; for an atomic,
    // its own home connector. (computer_use's pseudo-connector is not a registry
    // connector, so the powered-by registry mapping naturally drops it — those
    // never appear in composed specs.)
    const stepTools = cap.effectiveTools && cap.effectiveTools.length > 0
      ? cap.effectiveTools
      : [cap.id];
    for (const provider of uniqueConnectorsFor(stepTools)) derivedConnectors.add(provider);

    // This per-step check intentionally validates ONLY the capability's "home"
    // connector (cap.requiredConnector). For a cross-resource primitive
    // (e.g. nudge.unconfirmed-event reads gcal but drafts on gmail) the home
    // connector is just one of several it touches; full multi-connector
    // completeness is enforced by the derived-connector union assertion AFTER
    // this loop (every effectiveTool's connector must be granted AND in
    // requiredConnectors) and by validateSpec's tool→connector loop. Do NOT
    // remove either thinking this per-step check covers it — it does not.
    if (!granted.has(cap.requiredConnector)) {
      at(`step ${idx} needs connector "${cap.requiredConnector}", not connected`);
    }

    if (cap.kind === 'primitive') {
      // The runner's allowlist gate keys on the ATOMIC steps the primitive
      // yields, so the allowlist must contain the primitive's effectiveTools
      // (not the primitive id, which is not a connector capability).
      for (const tool of cap.effectiveTools ?? []) {
        if (!allowlist.has(tool)) {
          at(`step ${idx} primitive "${cap.id}" yields "${tool}" which is not in toolsAllowlist (the runner would kill it)`);
        }
      }
      try {
        resolvePrimitiveInputs(cap, step.inputs as Record<string, unknown> | undefined);
      } catch (err) {
        at(`step ${idx}: ${err instanceof Error ? err.message : 'invalid primitive inputs'}`);
      }
      continue;
    }

    // A composed write step MUST ride a primitive: a primitive's trusted
    // implementation builds its own effectArgs, but a RAW atomic write step
    // would carry effectArgs straight from `step.inputs` (the interpreter's
    // generic path only CRLF/length-sanitizes them) — reopening the very
    // attacker-controlled-args surface the primitive boundary closes (e.g. a
    // composed `email.send` with a `bcc` arg). Fail-closed: reject it here so a
    // composed write can only ever flow through a primitive.
    if (cap.sideEffect === 'write') {
      at(
        `step ${idx} capability "${cap.id}" is a raw ${cap.sideEffect} step — composed ${cap.sideEffect} steps must ride a primitive that owns its effectArgs, not a raw atomic capability`,
      );
      continue;
    }

    // Atomic step: its own id must be allowlisted.
    if (!allowlist.has(cap.id)) {
      at(`step ${idx} capability "${cap.id}" is not in toolsAllowlist (the runner would kill it)`);
    }

    // Atomic defense-in-depth: a read step must carry a safe connector-relative
    // path (the same guard the interpreter throws on at run time).
    if (cap.sideEffect === 'read') {
      const path = (step.inputs as Record<string, unknown> | undefined)?.path;
      const pathProblem = unsafeReadPathReason(path);
      if (pathProblem) at(`step ${idx} read path ${pathProblem}`);
    }
  }

  // FIX 1: assert the FULL derived connector union (above) is both granted on
  // this account AND declared in spec.requiredConnectors. The granted check
  // closes the cross-resource hole (a primitive's non-home connector — e.g.
  // gmail for nudge.unconfirmed-event — must be connected, not just its home
  // google-calendar). The requiredConnectors check closes the raw-spec omission
  // (a primitive touching gmail must LIST gmail, so the invariant "connectors ⊆
  // granted for the FULL union" holds for the persisted spec, not just at adopt
  // time). Fail-closed; message style matches the file (`... not connected` /
  // `powered by`).
  const required = new Set(spec.requiredConnectors);
  for (const provider of derivedConnectors) {
    if (!granted.has(provider)) {
      at(`a composed step is powered by connector "${provider}" which is not connected on this account`);
    }
    if (!required.has(provider)) {
      at(`a composed step is powered by connector "${provider}" which is missing from requiredConnectors`);
    }
  }

  return problems;
}

/* ── Planner (Slice 3a) validators — the trust boundary, applied twice ───────
 *
 * design §5: fail-closed on the PlanSpec at preview, AND fail-closed on every
 * runtime pick. Provisioning is fixed at preview and can never self-grant: the
 * picker may only select among the plan's `toolsAllowlist` (connector caps +
 * utility ids). An invalid pick yields NO step.
 */

/** Highest `maxIterations` a frontier plan may set (design §7 — bound the loop). */
export const MAX_PLAN_ITERATIONS = 30;

/** Hard ceiling on a plan's `maxTokens` — a crafted plan can't set 1e9 and turn
 *  the token-budget kill into a no-op (design §7: the loop is bounded by
 *  construction, not by an attacker-supplied number). */
export const MAX_PLAN_TOKENS = 20_000;

/**
 * Fail-closed validation of a synthesized PlanSpec, run at plan-preview before
 * the loop is ever provisioned. Returns problems (empty = valid):
 *  - every `toolsAllowlist` entry is a known connector capability OR a known
 *    utility id (an off-surface entry rejects the whole plan);
 *  - a `web.*` utility may appear only when a search provider is configured
 *    (`opts.webSearchEnabled`), since web egress is the load-bearing surface;
 *  - a `computer_use.*` (browser) verb may appear only when the browser surface
 *    is enabled (`opts.browserEnabled`), so a stale/persisted cu plan can't sit
 *    "valid" and silently flip live the moment the flag is turned on
 *    (defense-in-depth — the driver is also gated at run time);
 *  - every required connector is granted on this account;
 *  - every connector capability is powered by a granted required connector;
 *  - ceilings positive + `maxIterations` within `MAX_PLAN_ITERATIONS`.
 */
export function validatePlanSpec(
  plan: PlanSpec,
  accountConnections: string[],
  opts: { webSearchEnabled: boolean; browserEnabled?: boolean },
): string[] {
  const problems: string[] = [];
  const at = (msg: string) => problems.push(`plan: ${msg}`);

  if (plan.kind !== 'plan') at('not a plan spec');
  if (!plan.goal.trim()) at('goal required');

  // A plan that provisions ANY computer_use (browser) verb MUST run at the
  // computer_use weight class (10×, design §3 table); a plan over only
  // connector/utility tools runs at frontier. The weight class is load-bearing
  // for budget, so it is a structural check, not a hint.
  const usesComputerUse = plan.toolsAllowlist.some((id) => isComputerUseCapability(id));
  if (usesComputerUse) {
    if (plan.weightClass !== 'computer_use') at('a plan provisioning a computer_use verb must run at the "computer_use" weight class');
  } else if (plan.weightClass !== 'frontier') {
    at('plan weightClass must be "frontier" (or "computer_use" when it provisions a browser verb)');
  }

  const granted = new Set(accountConnections);
  for (const provider of plan.requiredConnectors) {
    if (!CONNECTOR_REGISTRY.has(provider)) at(`unknown connector "${provider}"`);
    else if (!granted.has(provider)) at(`required connector "${provider}" is not connected on this account`);
  }

  if (plan.toolsAllowlist.length === 0) at('tool allowlist must not be empty');
  for (const id of plan.toolsAllowlist) {
    const util = plannerTool(id);
    if (util) {
      // A web.* utility is only valid when a provider is configured: web egress
      // is offered to the loop only when it can actually (and safely) run.
      if (EGRESS_UTILITY_IDS.has(id) && !opts.webSearchEnabled) {
        at(`utility "${id}" requires a configured web-search provider`);
      }
      continue;
    }
    // A computer_use verb needs NO OAuth connector (it is driven by the injected
    // BrowserDriver). It is valid purely on being a registered computer_use
    // capability id — its safety is the verb+target schema (validatePick) +
    // approval-gating + the SSRF guard, not a connector grant. BUT it is offered
    // only when the browser surface is enabled: a cu verb in the allowlist while
    // COMPUTER_USE_ENABLED is off rejects the whole plan (defense-in-depth, so a
    // persisted cu plan can't be "valid" and silently flip live when the flag
    // turns on). `browserEnabled` defaults to false (fail-closed) when omitted.
    if (isComputerUseCapability(id)) {
      if (opts.browserEnabled !== true) {
        at(`tool "${id}" requires the browser (computer_use) surface to be enabled`);
      }
      continue;
    }

    const cap = capability(id);
    if (!cap) {
      at(`tool "${id}" is neither a registry capability nor a known utility`);
      continue;
    }
    // A connector capability must be powered by a granted required connector
    // (the home connector for atomic; the unique set for a primitive).
    const conns = cap.effectiveTools && cap.effectiveTools.length > 0
      ? uniqueConnectorsFor(cap.effectiveTools)
      : [cap.requiredConnector];
    for (const provider of conns) {
      if (!plan.requiredConnectors.includes(provider)) {
        at(`tool "${id}" needs connector "${provider}" which is not in requiredConnectors`);
      } else if (!granted.has(provider)) {
        at(`tool "${id}" needs connector "${provider}" which is not connected`);
      }
    }
  }

  // Ceilings: bound against the weight-class-appropriate maxima. A computer_use
  // run is supervised + heavier per action, so it is bounded TIGHTER than a
  // frontier plan (browser.COMPUTER_USE_CEILINGS); a frontier plan keeps the
  // existing bounds. A crafted plan can't widen either.
  const c = plan.ceilings;
  const tokenBound = usesComputerUse ? COMPUTER_USE_CEILINGS.maxTokens : MAX_PLAN_TOKENS;
  const iterBound = usesComputerUse ? COMPUTER_USE_CEILINGS.maxIterations : MAX_PLAN_ITERATIONS;
  if (c.maxSteps < 1 || c.maxTokens < 0 || c.maxWallClockMs < 1) at('per-run ceilings must be positive');
  if (!Number.isFinite(c.maxTokens) || c.maxTokens < 1) at('maxTokens must be a positive finite number');
  else if (c.maxTokens > tokenBound) at(`maxTokens ${c.maxTokens} exceeds the bound of ${tokenBound}`);
  if (!Number.isInteger(c.maxIterations) || c.maxIterations < 1) at('maxIterations must be a positive integer');
  else if (c.maxIterations > iterBound) at(`maxIterations ${c.maxIterations} exceeds the bound of ${iterBound}`);
  if (usesComputerUse && c.maxWallClockMs > COMPUTER_USE_CEILINGS.maxWallClockMs) {
    at(`maxWallClockMs ${c.maxWallClockMs} exceeds the computer_use bound of ${COMPUTER_USE_CEILINGS.maxWallClockMs}`);
  }

  return problems;
}

/** The unique connectors a set of atomic tool ids needs (server-side, from the
 *  registry — never from LLM output). Mirrors the Composer's connectorsFor. */
function uniqueConnectorsFor(tools: string[]): string[] {
  const set = new Set<string>();
  for (const t of tools) {
    const dep = capability(t);
    if (dep) set.add(dep.requiredConnector);
  }
  return [...set];
}

export type PlannerPickInput =
  | { tool: string; args: Record<string, unknown> }
  | { done: true; artifact: unknown }
  | { ask_human: true; kind: 'auth' | 'decision' | 'value'; question: string };

export type PickValidation = { ok: true } | { ok: false; reason: string };

/**
 * Fail-closed validation of ONE runtime pick (design §5), re-run every
 * iteration. An invalid pick is never yielded to the runner:
 *  - `done`: always valid (ends the loop);
 *  - `ask_human`: kind ∈ {auth,decision,value} and a non-empty question;
 *  - a tool pick: the tool ∈ the plan's `toolsAllowlist` (the provisioned
 *    surface — the loop can NEVER reach beyond it); then either
 *      • a utility → args validated against the utility's argSchema, OR
 *      • a connector capability → its connector granted; a primitive's args
 *        through `resolvePrimitiveInputs`; an atomic read's `path` through
 *        `assertSafeReadPath` (SSRF/traversal); an atomic draft/write is
 *        rejected (composed side effects must ride a primitive, as in
 *        validateComposedSpec).
 */
export function validatePick(
  pick: PlannerPickInput,
  plan: PlanSpec,
  accountConnections: string[],
): PickValidation {
  if ('done' in pick && pick.done === true) return { ok: true };

  if ('ask_human' in pick && pick.ask_human === true) {
    if (!['auth', 'decision', 'value'].includes(pick.kind)) {
      return { ok: false, reason: `ask_human kind must be auth|decision|value, got "${String(pick.kind)}"` };
    }
    if (typeof pick.question !== 'string' || pick.question.trim() === '') {
      return { ok: false, reason: 'ask_human needs a non-empty question' };
    }
    return { ok: true };
  }

  if (!('tool' in pick) || typeof pick.tool !== 'string') {
    return { ok: false, reason: 'pick has no tool' };
  }
  const tool = pick.tool;
  const args = (pick.args ?? {}) as Record<string, unknown>;

  // THE core boundary: the picked tool must be in the plan's provisioned surface.
  if (!plan.toolsAllowlist.includes(tool)) {
    return { ok: false, reason: `tool "${tool}" is not in the plan's provisioned surface` };
  }

  // A utility pick → schema-check its args.
  const util = plannerTool(tool);
  if (util) {
    try {
      resolveUtilityArgs(util, args);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'invalid utility args' };
    }
  }

  // A connector capability pick.
  const cap = capability(tool);
  if (!cap) return { ok: false, reason: `tool "${tool}" is not a registry capability` };

  // A computer_use (browser) verb: validate the verb + target schema fail-closed
  // (design §5). NO connector grant is checked (it is driven by the injected
  // BrowserDriver). The navigate URL's SSRF check is applied at dispatch time in
  // the harness (it needs the injected isPublicIp); here we validate shape only.
  // A click/type (write-class) is ALLOWED through here — unlike a raw connector
  // write — because its commit is approval-gated and the driver never
  // auto-commits; the picker is choosing to PROPOSE the action, not perform it.
  if (cap.family === 'computer_use') {
    const verb = cap.verb;
    if (!isComputerUseVerb(verb)) return { ok: false, reason: `unknown computer_use verb "${verb}"` };
    try {
      validateComputerUseArgs(verb as ComputerUseVerb, args);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'invalid computer_use args' };
    }
  }

  const granted = new Set(accountConnections);
  if (!granted.has(cap.requiredConnector)) {
    return { ok: false, reason: `tool "${tool}" needs connector "${cap.requiredConnector}" which is not granted` };
  }

  if (cap.kind === 'primitive') {
    try {
      resolvePrimitiveInputs(cap, args);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'invalid primitive args' };
    }
  }

  // Atomic capability. A write must ride a primitive (so the picker can
  // never inject effectArgs) — exactly the validateComposedSpec rule.
  if (cap.sideEffect === 'write') {
    return {
      ok: false,
      reason: `tool "${tool}" is a raw ${cap.sideEffect} capability — composed side effects must ride a primitive`,
    };
  }

  // Atomic read → its path must be safe (SSRF/traversal), reusing the
  // interpreter's run-time guard.
  try {
    assertSafeReadPath(args.path, tool);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'unsafe read path' };
  }
  return { ok: true };
}

/**
 * Validate + coerce a utility pick's args against the utility's argSchema —
 * the parallel of `resolvePrimitiveInputs` for the fixed utility set. Unknown
 * keys, missing-required, and out-of-bounds/type-mismatch all throw fail-closed.
 */
export function resolveUtilityArgs(
  util: PlannerTool,
  args: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const schema = util.argSchema;
  const given = args ?? {};
  for (const key of Object.keys(given)) {
    if (!Object.hasOwn(schema, key)) throw new Error(`utility ${util.id} got unknown arg "${key}"`);
  }
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema)) {
    const present = Object.hasOwn(given, key);
    const raw = present ? given[key] : undefined;
    if (raw === undefined || raw === null) {
      if (field.required) throw new Error(`utility ${util.id} missing required arg "${key}"`);
      continue;
    }
    out[key] = coerceUtilityField(util.id, key, field, raw);
  }
  return out;
}

function coerceUtilityField(
  utilId: string,
  key: string,
  field: PlannerTool['argSchema'][string],
  raw: unknown,
): unknown {
  if (field.type === 'number') {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error(`utility ${utilId} arg "${key}" must be a finite number`);
    if (field.min !== undefined && raw < field.min) throw new Error(`utility ${utilId} arg "${key}" below min ${field.min}`);
    if (field.max !== undefined && raw > field.max) throw new Error(`utility ${utilId} arg "${key}" above max ${field.max}`);
    return raw;
  }
  if (field.type === 'boolean') {
    if (typeof raw !== 'boolean') throw new Error(`utility ${utilId} arg "${key}" must be a boolean`);
    return raw;
  }
  if (field.type === 'string') {
    if (typeof raw !== 'string') throw new Error(`utility ${utilId} arg "${key}" must be a string`);
    return raw;
  }
  // enum
  if (typeof raw !== 'string' || !(field.values ?? []).includes(raw)) {
    throw new Error(`utility ${utilId} arg "${key}" must be one of ${(field.values ?? []).join(', ')}`);
  }
  return raw;
}

/** Deterministic JSON for the duplicate-step identity key: object keys are
 *  sorted recursively so two steps with the same params in a different key order
 *  hash identically (a duplicate is a duplicate regardless of key order). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** Mirror of the interpreter's assertSafeReadPath, as a reason string (null =
 *  safe). Defense-in-depth: a composed spec should never carry an atomic read
 *  path (primitives own them), but if one appears it is rejected here too. */
function unsafeReadPathReason(path: unknown): string | null {
  if (typeof path !== 'string' || path.length === 0) return 'is missing';
  if (path.includes('://')) return 'must be connector-relative, not an absolute URL';
  if (path.startsWith('//')) return 'must not be protocol-relative';
  if (!path.startsWith('/')) return "must start with '/'";
  if (path.includes('..')) return "must not contain '..' (traversal)";
  return null;
}
