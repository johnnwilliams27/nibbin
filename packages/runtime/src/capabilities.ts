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
import { digestInboxCleanup } from './primitives/digest-inbox-cleanup';
import { digestMorning } from './primitives/digest-morning';
import { nudgeOverdueEmail } from './primitives/nudge-overdue-email';
import { nudgeOverdueInvoice } from './primitives/nudge-overdue-invoice';
import { nudgeUnconfirmedEvent } from './primitives/nudge-unconfirmed-event';
import { replyNewInquiry } from './primitives/reply-new-inquiry';

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
  sideEffect: 'read' | 'write';
  requiredConnector: string;
  /**
   * For `write` capabilities: when `true`, the action level gates whether the
   * effect is presented as a draft for human approval or auto-executed. `false`
   * means the capability always executes (no native-draft path). Omitted on
   * `read` capabilities.
   */
  nativeDraft?: boolean;
  /**
   * Capability FAMILY. Absent/undefined = a connector capability (OAuth-backed,
   * lives behind a registry connector). `'computer_use'` = the browser /
   * computer-use surface (design §4 / R9): driven by an injected BrowserDriver,
   * NOT an OAuth connector — so it has no registry `requiredConnector` and the
   * Planner validators recognize it as a distinct class. It runs in the
   * `computer_use` weight class (10×) and its `requiredConnector` is the
   * pseudo-provider `BROWSER_PSEUDO_CONNECTOR` (never a registry connector).
   */
  family?: 'computer_use';
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
   * yields (e.g. nudge.overdue-email yields email.read + email.send). The
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

/**
 * The pseudo-provider for the `computer_use` family. It is NEVER a registry
 * connector (CONNECTOR_REGISTRY.has(BROWSER_PSEUDO_CONNECTOR) === false): the
 * browser surface is driven by an injected BrowserDriver, not OAuth. The
 * Planner validators key on `family === 'computer_use'`, not on this provider
 * being granted — so a computer_use plan needs NO connector grant. Defined as a
 * non-kebab string so it can never collide with a real connector id.
 */
export const BROWSER_PSEUDO_CONNECTOR = '@computer_use';

/** True when a capability id is a registered computer_use verb. */
export function isComputerUseCapability(id: string): boolean {
  return capability(id)?.family === 'computer_use';
}

/** The capabilities today's programs + grants reference. The durable abstraction
 *  Composer/Planner compose from (spec §4: (resource, verb) → side-effect).
 *
 * Task 3: `email.draft` retired. `email.send` is the single email write
 * capability (`nativeDraft: true` — the action level decides draft-vs-act).
 * `sideEffect` union is now `read | write` only (no `draft`). */
export const CAPABILITY_REGISTRY: Record<string, CapabilityDescriptor> = {
  'email.read':    { id: 'email.read',    resource: 'email',    verb: 'get',   sideEffect: 'read',  requiredConnector: 'gmail' },
  // Single email write capability. `nativeDraft: true` means the action level
  // decides whether the effect is presented as a draft (Observe/Draft) or
  // auto-executed (Send). Behavior is unchanged from the old email.draft path —
  // the runner gates it exactly as before; only the capability id is unified.
  'email.send':    { id: 'email.send',    resource: 'email',    verb: 'send',  sideEffect: 'write', nativeDraft: true,  requiredConnector: 'gmail', patternKeyPrefix: 'email.send' },
  'calendar.read': { id: 'calendar.read', resource: 'calendar', verb: 'get',   sideEffect: 'read',  requiredConnector: 'google-calendar' },
  // Calendar write (Connector Lever 1). A 'write' side effect: the interpreter
  // yields it as a DraftStep; the runner resolves draft-vs-execute via the
  // owner-set action level (observe/draft/send) + a calendar.event-create write
  // grant + idempotency before the effects executor ever calls createEvent.
  // Same wall as email.send — draft when action level is Draft; execute immediately
  // when action level is Send. No velocity caps (not a bulk-send rail).
  'calendar.event-create': { id: 'calendar.event-create', resource: 'calendar', verb: 'create', sideEffect: 'write', nativeDraft: false, requiredConnector: 'google-calendar', patternKeyPrefix: 'calendar.event-create' },
  'payments.read': { id: 'payments.read', resource: 'payments', verb: 'get',   sideEffect: 'read',  requiredConnector: 'stripe' },
  'invoice.nudge': { id: 'invoice.nudge', resource: 'invoice',  verb: 'nudge', sideEffect: 'write', requiredConnector: 'stripe', patternKeyPrefix: 'invoice.nudge' },

  // ── Primitives (composite capabilities; design §1) ─────────────────────────
  // A primitive bundles read→detect→draft as ONE trusted implementation the
  // Composer composes by id + typed params. The LLM never emits the read
  // paths / effectArgs; this descriptor's inputSchema bounds its only freedom.
  'nudge.overdue-email': {
    id: 'nudge.overdue-email',
    resource: 'email',
    verb: 'nudge',
    sideEffect: 'write',
    requiredConnector: 'gmail',
    patternKeyPrefix: 'email.send',
    kind: 'primitive',
    inputSchema: {
      staleDays: { type: 'number', default: 3, min: 1, max: 30 },
    },
    // The detect-and-nudge impl reads the mailbox (email.read) then drafts the
    // follow-up (email.send) — the two atomic tools its yielded steps gate on.
    effectiveTools: ['email.read', 'email.send'],
  },
  // From `tally`: watch stripe invoices, draft a nudge for the worst overdue one.
  'nudge.overdue-invoice': {
    id: 'nudge.overdue-invoice',
    resource: 'invoice',
    verb: 'nudge',
    sideEffect: 'write',
    requiredConnector: 'stripe',
    patternKeyPrefix: 'invoice.nudge',
    kind: 'primitive',
    inputSchema: {
      minDaysLate: { type: 'number', default: 0, min: 0, max: 120 },
    },
    effectiveTools: ['payments.read', 'invoice.nudge'],
  },
  // From `hopper`: CROSS-RESOURCE — read the calendar (google-calendar), draft a
  // confirmation email (gmail). The Composer derives BOTH connectors from
  // effectiveTools; `requiredConnector` is just the primitive's "home" resource.
  'nudge.unconfirmed-event': {
    id: 'nudge.unconfirmed-event',
    resource: 'calendar',
    verb: 'nudge',
    sideEffect: 'write',
    requiredConnector: 'google-calendar',
    patternKeyPrefix: 'email.send',
    kind: 'primitive',
    inputSchema: {
      withinDays: { type: 'number', default: 7, min: 1, max: 60 },
    },
    effectiveTools: ['calendar.read', 'email.send'],
  },
  // From `scribe`: read the mailbox, draft a warm first reply to a new inquiry.
  'reply.new-inquiry': {
    id: 'reply.new-inquiry',
    resource: 'email',
    verb: 'reply',
    sideEffect: 'write',
    requiredConnector: 'gmail',
    patternKeyPrefix: 'email.send',
    kind: 'primitive',
    // No scalar knob — first-contact detection isn't day-parameterized. An empty
    // schema is valid (resolvePrimitiveInputs with {} accepts no keys).
    inputSchema: {},
    effectiveTools: ['email.read', 'email.send'],
  },

  // ── Digest / summarize shape (design §2; Slice 2c) — PRESENTATION primitives ─
  // Read → present, no side effect. The yielded draft is a READ capability
  // (email.read) with presentation:true, so the runner gates it as a draft
  // ALWAYS and never executes — strictly lower-stakes than the nudge family.
  // From `sweep`: sweep the mailbox, group newsletter-ish senders, present a
  // top-N keep-or-clear digest. Presentation only — nothing is sent or deleted.
  'digest.inbox-cleanup': {
    id: 'digest.inbox-cleanup',
    resource: 'email',
    verb: 'digest',
    sideEffect: 'read',
    requiredConnector: 'gmail',
    patternKeyPrefix: 'sweep',
    kind: 'primitive',
    inputSchema: {
      topSenders: { type: 'number', default: 5, min: 1, max: 20 },
    },
    // The digest reads the mailbox (email.read) and presents the keep-or-clear
    // list as a presentation draft (also email.read — no send). One tool.
    effectiveTools: ['email.read'],
  },
  // From `brief`: the 3-CONNECTOR aggregation — read the calendar
  // (google-calendar), Stripe invoices (stripe), and fresh mail (gmail), then
  // compose ONE 3-part morning digest. The Composer derives ALL THREE connectors
  // from effectiveTools; `requiredConnector` is just the primitive's "home"
  // resource. Presentation only — nothing is sent.
  'digest.morning': {
    id: 'digest.morning',
    resource: 'calendar',
    verb: 'digest',
    sideEffect: 'read',
    requiredConnector: 'google-calendar',
    patternKeyPrefix: 'brief',
    kind: 'primitive',
    // No scalar knob — brief has fixed windows. An empty schema is valid.
    inputSchema: {},
    effectiveTools: ['calendar.read', 'payments.read', 'email.read'],
  },

  // ── computer_use family (design §4 / R9) — the browser surface ──────────────
  // A unified `target` (selector | coords, OCR fallback) over six verbs, driven
  // by an injected BrowserDriver (NOT an OAuth connector). reads:
  // navigate/extract/screenshot/scroll → quarantined; writes: click/type →
  // approval-gated drafts. No arbitrary-JS/eval verb exists. Runs at the
  // `computer_use` weight class (10×). `requiredConnector` is the pseudo-provider
  // BROWSER_PSEUDO_CONNECTOR so these never resolve to a registry connector; the
  // Planner validators key on `family === 'computer_use'`.
  'computer_use.navigate':   { id: 'computer_use.navigate',   resource: 'browser', verb: 'navigate',   sideEffect: 'read',  requiredConnector: BROWSER_PSEUDO_CONNECTOR, family: 'computer_use' },
  'computer_use.extract':    { id: 'computer_use.extract',    resource: 'browser', verb: 'extract',    sideEffect: 'read',  requiredConnector: BROWSER_PSEUDO_CONNECTOR, family: 'computer_use' },
  'computer_use.screenshot': { id: 'computer_use.screenshot', resource: 'browser', verb: 'screenshot', sideEffect: 'read',  requiredConnector: BROWSER_PSEUDO_CONNECTOR, family: 'computer_use' },
  'computer_use.scroll':     { id: 'computer_use.scroll',     resource: 'browser', verb: 'scroll',     sideEffect: 'read',  requiredConnector: BROWSER_PSEUDO_CONNECTOR, family: 'computer_use' },
  'computer_use.click':      { id: 'computer_use.click',      resource: 'browser', verb: 'click',      sideEffect: 'write', requiredConnector: BROWSER_PSEUDO_CONNECTOR, family: 'computer_use', patternKeyPrefix: 'computer_use.click' },
  'computer_use.type':       { id: 'computer_use.type',       resource: 'browser', verb: 'type',       sideEffect: 'write', requiredConnector: BROWSER_PSEUDO_CONNECTOR, family: 'computer_use', patternKeyPrefix: 'computer_use.type' },
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
  'nudge.overdue-invoice': (inputs, connMap, nowMs) =>
    nudgeOverdueInvoice(
      { minDaysLate: typeof inputs.minDaysLate === 'number' ? inputs.minDaysLate : undefined },
      connMap,
      nowMs,
    ),
  'nudge.unconfirmed-event': (inputs, connMap, nowMs) =>
    nudgeUnconfirmedEvent(
      { withinDays: typeof inputs.withinDays === 'number' ? inputs.withinDays : undefined },
      connMap,
      nowMs,
    ),
  'reply.new-inquiry': (_inputs, connMap, nowMs) => replyNewInquiry({}, connMap, nowMs),
  'digest.inbox-cleanup': (inputs, connMap, nowMs) =>
    digestInboxCleanup(
      { topSenders: typeof inputs.topSenders === 'number' ? inputs.topSenders : undefined },
      connMap,
      nowMs,
    ),
  'digest.morning': (_inputs, connMap, nowMs) => digestMorning({}, connMap, nowMs),
};

export function capability(id: string): CapabilityDescriptor | undefined {
  // Object.hasOwn (not bracket access / `in`) so inherited members like
  // 'constructor'/'toString'/'__proto__' never resolve to a truthy descriptor
  // (a prototype-pollution-shaped lookup must return undefined, not Object's).
  return Object.hasOwn(CAPABILITY_REGISTRY, id) ? CAPABILITY_REGISTRY[id] : undefined;
}
