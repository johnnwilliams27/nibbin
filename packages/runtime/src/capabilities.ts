/**
 * The capability registry — the durable abstraction synthesis composes from
 * (design §4: a capability is `(resource, verb) → side-effect`). Today's six
 * hand-written programs (apps/web/lib/runtime/programs.ts) and the shop
 * templates' `toolsAllowlist` reference these by id; the conformance test
 * binds them to this registry (no orphan capabilities) WITHOUT rewriting the
 * imperative programs. Composer (Slice 2) emits `steps[]` over these same ids,
 * which the interpreter runs through the unchanged runner gates.
 *
 * `requiredConnector` matches what each program's `requireConn(...)` actually
 * uses: email.* → gmail, calendar.read → google-calendar, payments/invoice →
 * stripe. `patternKeyPrefix` is the routine-matching identity prefix for
 * draft/write capabilities (§4.7), so the interpreter mints the same
 * patternKey shape the programs do.
 */
import type { ProgramFn } from './runner';
import { nudgeOverdueEmail } from './primitives/nudge-overdue-email';

/**
 * A typed input field for a PRIMITIVE capability's `inputSchema` (design §1).
 * The Composer's only freedom is choosing a primitive id + values for these
 * scalar fields, validated against type/bounds — it never emits read paths or
 * effectArgs (those are built by the primitive's trusted implementation).
 */
export interface PrimitiveInputField {
  type: 'number' | 'string' | 'enum';
  default?: unknown;
  min?: number;
  max?: number;
  values?: string[];
  required?: boolean;
}

export interface CapabilityDescriptor {
  id: string;
  resource: string;
  verb: string;
  sideEffect: 'read' | 'draft' | 'write';
  requiredConnector: string;
  /** routine-matching identity prefix for draft/write capabilities (School §4.7). */
  patternKeyPrefix?: string;
  /**
   * Atomic capabilities (Slice 1 — the six below) yield ONE gated step; a
   * primitive (composite, design §1) has a trusted server-side implementation
   * that yields many steps. Default 'atomic' (omitted on the back-compat
   * entries).
   */
  kind?: 'atomic' | 'primitive';
  /** Primitives only: the typed scalar params the Composer may set. */
  inputSchema?: Record<string, PrimitiveInputField>;
  /**
   * Primitives only: the ATOMIC capability ids the implementation actually
   * yields (e.g. nudge.overdue-email yields email.read + email.draft). The
   * runner's allowlist gate keys on the YIELDED step's capability, not the
   * primitive id — so a composed spec's `toolsAllowlist` must list these, and
   * `validateSpec` (connector-registry powered) validates these, not the
   * primitive id (which is not a connector capability). The Composer copies
   * this into `toolsAllowlist`; validateComposedSpec checks against it.
   */
  effectiveTools?: string[];
}

/**
 * A primitive's trusted implementation factory: bound inputs (already schema-
 * validated) + the account's connector map + the run clock → a ProgramFn the
 * interpreter `yield*`s. Registered separately from the descriptor so the
 * registry stays pure data.
 */
export type PrimitiveImpl = (
  inputs: Record<string, unknown>,
  connMap: Record<string, string | undefined>,
  nowMs: number,
) => ProgramFn;

/** The capabilities today's programs + grants reference. The durable abstraction
 *  Composer/Planner compose from (spec §4: (resource, verb) → side-effect). */
export const CAPABILITY_REGISTRY: Record<string, CapabilityDescriptor> = {
  'email.read':    { id: 'email.read',    resource: 'email',    verb: 'get',   sideEffect: 'read',  requiredConnector: 'gmail' },
  'email.draft':   { id: 'email.draft',   resource: 'email',    verb: 'draft', sideEffect: 'draft', requiredConnector: 'gmail', patternKeyPrefix: 'email.draft' },
  'email.send':    { id: 'email.send',    resource: 'email',    verb: 'send',  sideEffect: 'write', requiredConnector: 'gmail', patternKeyPrefix: 'email.send' },
  'calendar.read': { id: 'calendar.read', resource: 'calendar', verb: 'get',   sideEffect: 'read',  requiredConnector: 'google-calendar' },
  'payments.read': { id: 'payments.read', resource: 'payments', verb: 'get',   sideEffect: 'read',  requiredConnector: 'stripe' },
  'invoice.nudge': { id: 'invoice.nudge', resource: 'invoice',  verb: 'nudge', sideEffect: 'draft', requiredConnector: 'stripe', patternKeyPrefix: 'invoice.nudge' },

  // ── Primitives (composite capabilities; design §1) ─────────────────────────
  // A primitive bundles read→detect→draft as ONE trusted implementation the
  // Composer composes by id + typed params. The LLM never emits the read
  // paths / effectArgs; this descriptor's inputSchema bounds its only freedom.
  'nudge.overdue-email': {
    id: 'nudge.overdue-email',
    resource: 'email',
    verb: 'nudge',
    sideEffect: 'draft',
    requiredConnector: 'gmail',
    patternKeyPrefix: 'email.draft',
    kind: 'primitive',
    inputSchema: {
      staleDays: { type: 'number', default: 3, min: 1, max: 30 },
    },
    // The detect-and-nudge impl reads the mailbox (email.read) then drafts the
    // follow-up (email.draft) — the two atomic tools its yielded steps gate on.
    effectiveTools: ['email.read', 'email.draft'],
  },
};

/**
 * Trusted implementation factories for primitive capabilities (design §1/§2.2).
 * Kept separate from the descriptor so the registry stays pure data; the
 * interpreter dispatches a primitive step through `PRIMITIVE_IMPLS[cap.id]`.
 */
export const PRIMITIVE_IMPLS: Record<string, PrimitiveImpl> = {
  'nudge.overdue-email': (inputs, connMap, nowMs) =>
    nudgeOverdueEmail(
      { staleDays: typeof inputs.staleDays === 'number' ? inputs.staleDays : undefined },
      connMap,
      nowMs,
    ),
};

export function capability(id: string): CapabilityDescriptor | undefined {
  // Object.hasOwn (not bracket access / `in`) so inherited members like
  // 'constructor'/'toString'/'__proto__' never resolve to a truthy descriptor
  // (a prototype-pollution-shaped lookup must return undefined, not Object's).
  return Object.hasOwn(CAPABILITY_REGISTRY, id) ? CAPABILITY_REGISTRY[id] : undefined;
}
