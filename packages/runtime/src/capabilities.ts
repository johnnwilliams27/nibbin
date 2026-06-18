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
export interface CapabilityDescriptor {
  id: string;
  resource: string;
  verb: string;
  sideEffect: 'read' | 'draft' | 'write';
  requiredConnector: string;
  /** routine-matching identity prefix for draft/write capabilities (School §4.7). */
  patternKeyPrefix?: string;
}

/** The capabilities today's programs + grants reference. The durable abstraction
 *  Composer/Planner compose from (spec §4: (resource, verb) → side-effect). */
export const CAPABILITY_REGISTRY: Record<string, CapabilityDescriptor> = {
  'email.read':    { id: 'email.read',    resource: 'email',    verb: 'get',   sideEffect: 'read',  requiredConnector: 'gmail' },
  'email.draft':   { id: 'email.draft',   resource: 'email',    verb: 'draft', sideEffect: 'draft', requiredConnector: 'gmail', patternKeyPrefix: 'email.draft' },
  'email.send':    { id: 'email.send',    resource: 'email',    verb: 'send',  sideEffect: 'write', requiredConnector: 'gmail', patternKeyPrefix: 'email.send' },
  'calendar.read': { id: 'calendar.read', resource: 'calendar', verb: 'get',   sideEffect: 'read',  requiredConnector: 'google-calendar' },
  'payments.read': { id: 'payments.read', resource: 'payments', verb: 'get',   sideEffect: 'read',  requiredConnector: 'stripe' },
  'invoice.nudge': { id: 'invoice.nudge', resource: 'invoice',  verb: 'nudge', sideEffect: 'draft', requiredConnector: 'stripe', patternKeyPrefix: 'invoice.nudge' },
};

export function capability(id: string): CapabilityDescriptor | undefined {
  return CAPABILITY_REGISTRY[id];
}
