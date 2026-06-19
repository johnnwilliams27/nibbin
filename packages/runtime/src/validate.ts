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
import { capability } from './capabilities';
import { assertSafeReadPath, resolvePrimitiveInputs } from './interpreter';
import { plannerTool, EGRESS_UTILITY_IDS } from './utilities';
import type { AgentSpec, PlanSpec, PlannerTool, TriggerDef } from './types';

export const KEEPER_NODE = 'keeper';

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

  let idx = -1;
  for (const step of steps) {
    idx += 1;
    const cap = capability(step.capability);
    if (!cap) {
      at(`step ${idx} capability "${step.capability}" is not a registry capability`);
      continue;
    }
    // This per-step check intentionally validates ONLY the capability's "home"
    // connector (cap.requiredConnector). For a cross-resource primitive
    // (e.g. nudge.unconfirmed-event reads gcal but drafts on gmail) the home
    // connector is just one of several it touches; full multi-connector
    // completeness is enforced SEPARATELY by the `requiredConnectors ⊆
    // accountConnections` loop above and by validateSpec's tool→connector loop
    // (every effectiveTool must be powered by a required connector). Do NOT
    // remove that loop thinking this per-step check covers it — it does not.
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

    // A composed draft/write step MUST ride a primitive: a primitive's trusted
    // implementation builds its own effectArgs, but a RAW atomic draft/write
    // step would carry effectArgs straight from `step.inputs` (the interpreter's
    // generic path only CRLF/length-sanitizes them) — reopening the very
    // attacker-controlled-args surface the primitive boundary closes (e.g. a
    // composed `email.send` with a `bcc` arg). Fail-closed: reject it here so a
    // composed write can only ever flow through a primitive.
    if (cap.sideEffect === 'draft' || cap.sideEffect === 'write') {
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
 *  - every required connector is granted on this account;
 *  - every connector capability is powered by a granted required connector;
 *  - ceilings positive + `maxIterations` within `MAX_PLAN_ITERATIONS`.
 */
export function validatePlanSpec(
  plan: PlanSpec,
  accountConnections: string[],
  opts: { webSearchEnabled: boolean },
): string[] {
  const problems: string[] = [];
  const at = (msg: string) => problems.push(`plan: ${msg}`);

  if (plan.kind !== 'plan') at('not a plan spec');
  if (!plan.goal.trim()) at('goal required');
  if (plan.weightClass !== 'frontier') at('plan weightClass must be "frontier"');

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

  const c = plan.ceilings;
  if (c.maxSteps < 1 || c.maxTokens < 0 || c.maxWallClockMs < 1) at('per-run ceilings must be positive');
  // Bound maxTokens (floor + hard ceiling): a crafted plan can't set maxTokens
  // to 1e9 and neuter the token-budget kill. The server re-stamps the canonical
  // ceilings anyway (actions.startPlanRun), but the validator is the trust gate.
  if (!Number.isFinite(c.maxTokens) || c.maxTokens < 1) at('maxTokens must be a positive finite number');
  else if (c.maxTokens > MAX_PLAN_TOKENS) at(`maxTokens ${c.maxTokens} exceeds the bound of ${MAX_PLAN_TOKENS}`);
  if (!Number.isInteger(c.maxIterations) || c.maxIterations < 1) at('maxIterations must be a positive integer');
  else if (c.maxIterations > MAX_PLAN_ITERATIONS) at(`maxIterations ${c.maxIterations} exceeds the bound of ${MAX_PLAN_ITERATIONS}`);

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

  // Atomic capability. A draft/write must ride a primitive (so the picker can
  // never inject effectArgs) — exactly the validateComposedSpec rule.
  if (cap.sideEffect === 'draft' || cap.sideEffect === 'write') {
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
