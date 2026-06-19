/**
 * The standard utility toolset (design §4 / SPEC §7.2) — a FIXED registry of
 * tools the Planner harness dispatches in-process, distinct from connector
 * capabilities. A plan's `toolsAllowlist` may name these ids; the picker may
 * select among them; `validatePick` schema-checks their args.
 *
 *  - scratchpad.write / scratchpad.read — run-scoped working memory, no egress
 *  - memory.retrieve                     — READ the RAG memory_entries (#135)
 *  - web.search / web.fetch              — open-web egress (redact→allowlist→quarantine)
 *  - ask_human                           — escalate → needs_input
 *  - done                                — end the loop with an artifact
 *
 * Pure data + a prototype-safe lookup (the 2b/Slice-1 `Object.hasOwn` pattern),
 * so an inherited key like '__proto__'/'constructor' never resolves to a tool.
 */
import type { PlannerTool, PlannerToolId } from './types';

export const STANDARD_UTILITIES: Record<PlannerToolId, PlannerTool> = {
  'scratchpad.write': {
    id: 'scratchpad.write',
    egress: false,
    argSchema: {
      key: { type: 'string', required: true },
      value: { type: 'string', required: true },
    },
  },
  'scratchpad.read': {
    id: 'scratchpad.read',
    egress: false,
    argSchema: {
      key: { type: 'string', required: true },
    },
  },
  'memory.retrieve': {
    id: 'memory.retrieve',
    egress: false,
    argSchema: {
      query: { type: 'string', required: true },
      k: { type: 'number', required: false, min: 1, max: 10 },
    },
  },
  'web.search': {
    id: 'web.search',
    egress: true,
    argSchema: {
      query: { type: 'string', required: true },
    },
  },
  'web.fetch': {
    id: 'web.fetch',
    egress: true,
    argSchema: {
      url: { type: 'string', required: true },
    },
  },
  'ask_human': {
    id: 'ask_human',
    egress: false,
    argSchema: {
      kind: { type: 'enum', required: true, values: ['auth', 'decision', 'value'] },
      question: { type: 'string', required: true },
    },
  },
  'done': {
    id: 'done',
    egress: false,
    argSchema: {
      summary: { type: 'string', required: true },
    },
  },
};

/** Prototype-safe lookup (mirrors capabilities.ts `capability()`): an inherited
 *  member like 'constructor'/'toString'/'__proto__' must return undefined. */
export function plannerTool(id: string): PlannerTool | undefined {
  return Object.hasOwn(STANDARD_UTILITIES, id)
    ? STANDARD_UTILITIES[id as PlannerToolId]
    : undefined;
}

export const UTILITY_IDS: ReadonlySet<string> = new Set(Object.keys(STANDARD_UTILITIES));

/** Egressing utility ids (web.*), as a set — Task 4/5 filter these out when no
 *  search provider is configured. */
export const EGRESS_UTILITY_IDS: ReadonlySet<string> = new Set(
  (Object.values(STANDARD_UTILITIES) as PlannerTool[]).filter((u) => u.egress).map((u) => u.id),
);
