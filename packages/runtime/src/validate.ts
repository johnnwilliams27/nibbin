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
import type { AgentSpec, TriggerDef } from './types';

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
