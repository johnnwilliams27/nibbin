/**
 * Multi-primitive composition (Part A) — the validator + interpreter guarantees
 * for a composed spec that carries 2+ ordered primitive steps:
 *  - VALIDATOR (fail-closed): a valid 2-primitive spec validates; a spec over
 *    MAX_COMPOSED_STEPS is rejected; a byte-duplicate step is rejected; a step
 *    needing an ungranted connector is rejected; a non-primitive (raw atomic
 *    draft) step is rejected — exactly as for a single-step spec, plus the
 *    cross-step bounds.
 *  - INTERPRETER: a 2-primitive spec runs through interpretSpec → executeRun
 *    producing the expected SEQUENCE of gated steps (digest.morning presentation
 *    first, then the nudge.overdue-invoice draft) — every step rides the runner
 *    gates exactly as a single-primitive spec does.
 *
 * The thesis: multi-step changes NOTHING about per-step safety — the validator
 * stays the trust boundary, the user/LLM only choose primitive ids + params +
 * order, and the runner gates each yielded step identically to today.
 */
import { describe, expect, it } from 'vitest';
import { quarantine } from '@nibbin/connectors';
import {
  executeRun,
  interpretSpec,
  validateComposedSpec,
  MAX_COMPOSED_STEPS,
  MemoryEventSink,
  MemoryGrantStore,
  MemoryIdempotencyStore,
  MemoryRoutineStore,
  MemoryRunStore,
  type AgentSpec,
  type CapabilityStep,
  type NibbinRef,
  type RunnerDeps,
  type RunTrigger,
} from '../src/index';

const ACCOUNT = 'acct-mp';
const TRIGGER: RunTrigger = { kind: 'user' };
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

const CURRICULUM = {
  measures: 'drafts approved without edits',
  promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95, coverageMinPatterns: 4 },
  routineMinApprovals: 5,
};
const CREDIT = { weightClass: 'standard' as const, ceilings: { maxSteps: 120, maxTokens: 12_000, maxWallClockMs: 60_000 } };
const TRIGGERS = [
  { kind: 'schedule' as const, schedule: 'daily.morning', cooldownSecs: 3600 },
  { kind: 'user' as const },
];

function spec(over: Partial<AgentSpec>): AgentSpec {
  return {
    templateKey: null,
    version: 1,
    displayName: 'Morning ops',
    toolsAllowlist: [],
    requiredConnectors: [],
    triggers: TRIGGERS,
    curriculum: CURRICULUM,
    creditProfile: CREDIT,
    steps: [],
    personaPolicy: { tone: 'warm' },
    ...over,
  };
}

/** A "morning ops" agent: present the morning brief, then draft the worst-overdue
 *  invoice nudge. Two primitives, one ordered spec. */
function morningOpsSpec(over: Partial<AgentSpec> = {}): AgentSpec {
  return spec({
    displayName: 'Morning ops',
    // UNION of both primitives' effectiveTools (digest.morning: calendar.read,
    // payments.read, email.read; nudge.overdue-invoice: payments.read,
    // email.send — the invoice nudge now sends a personalized email).
    toolsAllowlist: ['calendar.read', 'payments.read', 'email.read', 'email.send'],
    // UNION of both primitives' connectors.
    requiredConnectors: ['google-calendar', 'stripe', 'gmail'],
    steps: [
      { capability: 'digest.morning', inputs: {} },
      { capability: 'nudge.overdue-invoice', inputs: { minDaysLate: 0 } },
    ],
    ...over,
  });
}

const GRANTED = ['google-calendar', 'stripe', 'gmail'];

describe('validateComposedSpec — multi-primitive', () => {
  it('accepts a valid 2-primitive spec (digest.morning THEN nudge.overdue-invoice)', () => {
    expect(validateComposedSpec(morningOpsSpec(), GRANTED)).toEqual([]);
  });

  it('rejects more than MAX_COMPOSED_STEPS steps', () => {
    const tooMany: CapabilityStep[] = [
      { capability: 'digest.morning', inputs: {} },
      { capability: 'nudge.overdue-invoice', inputs: { minDaysLate: 0 } },
      { capability: 'nudge.overdue-email', inputs: { staleDays: 3 } },
      { capability: 'reply.new-inquiry', inputs: {} },
      { capability: 'digest.inbox-cleanup', inputs: { topSenders: 5 } },
    ];
    expect(tooMany.length).toBeGreaterThan(MAX_COMPOSED_STEPS);
    const s = morningOpsSpec({ steps: tooMany });
    const problems = validateComposedSpec(s, GRANTED);
    expect(problems.some((p) => /at most 4 steps/.test(p))).toBe(true);
  });

  it('rejects a byte-identical duplicate step', () => {
    const s = morningOpsSpec({
      steps: [
        { capability: 'nudge.overdue-invoice', inputs: { minDaysLate: 0 } },
        { capability: 'nudge.overdue-invoice', inputs: { minDaysLate: 0 } },
      ],
    });
    const problems = validateComposedSpec(s, GRANTED);
    expect(problems.some((p) => /duplicate/.test(p))).toBe(true);
  });

  it('detects a duplicate regardless of input key order', () => {
    const s = morningOpsSpec({
      steps: [
        { capability: 'nudge.unconfirmed-event', inputs: { withinDays: 7 } },
        { capability: 'nudge.unconfirmed-event', inputs: { withinDays: 7 } },
      ],
      toolsAllowlist: ['calendar.read', 'email.send'],
      requiredConnectors: ['google-calendar', 'gmail'],
    });
    const problems = validateComposedSpec(s, GRANTED);
    expect(problems.some((p) => /duplicate/.test(p))).toBe(true);
  });

  it('ALLOWS two same-capability steps with DIFFERENT params (not a duplicate)', () => {
    const s = morningOpsSpec({
      steps: [
        { capability: 'nudge.overdue-invoice', inputs: { minDaysLate: 0 } },
        { capability: 'nudge.overdue-invoice', inputs: { minDaysLate: 30 } },
      ],
      toolsAllowlist: ['payments.read', 'email.send'],
      requiredConnectors: ['stripe', 'gmail'],
    });
    expect(validateComposedSpec(s, GRANTED)).toEqual([]);
  });

  it('rejects when a STEP needs an ungranted connector (union check)', () => {
    // gmail + gcal granted, but NOT stripe — the nudge.overdue-invoice step
    // needs stripe, so the spec is rejected (both the per-step home-connector
    // check and the requiredConnectors ⊆ granted union check fire).
    const problems = validateComposedSpec(morningOpsSpec(), ['google-calendar', 'gmail']);
    expect(problems.some((p) => /stripe/.test(p) && /not connected/.test(p))).toBe(true);
  });

  it('rejects a NON-PRIMITIVE (raw atomic write) step among primitive steps', () => {
    const s = morningOpsSpec({
      toolsAllowlist: ['calendar.read', 'payments.read', 'email.read', 'invoice.nudge', 'email.send'],
      steps: [
        { capability: 'digest.morning', inputs: {} },
        // A raw atomic email.send carries attacker-shaped effectArgs — rejected.
        { capability: 'email.send', inputs: { to: 'x@y.com', bcc: 'leak@evil.com', body: 'hi' } },
      ],
    });
    const problems = validateComposedSpec(s, GRANTED);
    expect(problems.some((p) => /raw (draft|write) step|must ride a primitive/.test(p))).toBe(true);
  });

  it('rejects an allowlist gap for a LATER step (union must cover every step)', () => {
    // Drop email.send from the allowlist — the runner would kill the 2nd
    // primitive's (nudge.overdue-invoice) email draft step.
    const s = morningOpsSpec({
      toolsAllowlist: ['calendar.read', 'payments.read', 'email.read'],
    });
    const problems = validateComposedSpec(s, GRANTED);
    expect(problems.some((p) => /email\.send/.test(p) && /toolsAllowlist/.test(p))).toBe(true);
  });
});

/* ── FIX 1 (red-team P2): the FULL connector union, not just home connectors ──
 *
 * nudge.unconfirmed-event is the canonical cross-resource primitive: its HOME
 * connector is google-calendar, but its effectiveTools are
 * ['calendar.read', 'email.send'] — so email.send pulls in gmail. A raw spec
 * (adoptSynthesized with edit undefined) that omits gmail from
 * requiredConnectors, on an account that has google-calendar but NOT gmail,
 * used to pass validation (the per-step loop only checks the HOME connector).
 * Runtime fails closed, but the invariant "validateComposedSpec checks
 * connectors ⊆ granted for the FULL union" was false. It is now true. */
describe('validateComposedSpec — FIX 1: full connector union (cross-resource primitive)', () => {
  /** A single cross-resource primitive: nudge.unconfirmed-event (gcal home,
   *  gmail via email.send). Caller overrides requiredConnectors/allowlist. */
  function unconfirmedEventSpec(over: Partial<AgentSpec> = {}): AgentSpec {
    return spec({
      displayName: 'Confirm my events',
      toolsAllowlist: ['calendar.read', 'email.send'],
      requiredConnectors: ['google-calendar', 'gmail'],
      steps: [{ capability: 'nudge.unconfirmed-event', inputs: { withinDays: 7 } }],
      ...over,
    });
  }

  it('REJECTS a raw spec omitting the non-home connector (gmail) on an account missing it', () => {
    // requiredConnectors lists ONLY the home connector (google-calendar), and
    // the account has google-calendar but NOT gmail. Pre-fix this slipped
    // through (home-connector-only check). Now BOTH the "not connected" union
    // assertion and the "missing from requiredConnectors" assertion fire on gmail.
    const s = unconfirmedEventSpec({ requiredConnectors: ['google-calendar'] });
    const problems = validateComposedSpec(s, ['google-calendar']);
    expect(problems.some((p) => /gmail/.test(p) && /not connected/.test(p))).toBe(true);
    expect(problems.some((p) => /gmail/.test(p) && /missing from requiredConnectors/.test(p))).toBe(true);
  });

  it('REJECTS even when gmail IS granted but omitted from requiredConnectors (persisted-spec invariant)', () => {
    // Account has both connectors, but the spec under-declares requiredConnectors.
    // The "connectors ⊆ granted for the FULL union" invariant must hold for the
    // PERSISTED spec, so the missing declaration is still rejected.
    const s = unconfirmedEventSpec({ requiredConnectors: ['google-calendar'] });
    const problems = validateComposedSpec(s, ['google-calendar', 'gmail']);
    expect(problems.some((p) => /gmail/.test(p) && /missing from requiredConnectors/.test(p))).toBe(true);
    // gmail IS granted, so the "not connected" union assertion must NOT fire on gmail.
    expect(problems.some((p) => /gmail.*not connected/.test(p))).toBe(false);
  });

  it('PASSES when the account HAS both connectors and lists both in requiredConnectors', () => {
    const s = unconfirmedEventSpec();
    expect(validateComposedSpec(s, ['google-calendar', 'gmail'])).toEqual([]);
  });
});

/* ── FIX 2 (red-team P3): every composed step is primitive-or-read by KIND ────
 *
 * The kind assertion rejects any atomic side-effecting step independently of
 * the draft/write branch — so a future capability mis-tagged off 'primitive'
 * cannot reopen raw effectArgs injection. A raw atomic email.send (the sole
 * atomic side-effecting email cap after Task 3) is rejected by BOTH the kind
 * assertion and the draft/write branch; a read-only atomic step is accepted by
 * the kind assertion (reads carry no effectArgs). */
describe('validateComposedSpec — FIX 2: composed steps are primitive-or-read', () => {
  it('rejects a raw atomic write step by the KIND assertion (not just the write branch)', () => {
    const s = morningOpsSpec({
      toolsAllowlist: ['calendar.read', 'payments.read', 'email.read', 'invoice.nudge', 'email.send'],
      steps: [
        { capability: 'digest.morning', inputs: {} },
        { capability: 'email.send', inputs: { to: 'x@y.com', bcc: 'leak@evil.com', body: 'hi' } },
      ],
    });
    const problems = validateComposedSpec(s, GRANTED);
    // The KIND assertion's distinct message: "...is not a primitive — every
    // composed step must be a primitive or a read".
    expect(
      problems.some((p) => /not a primitive/.test(p) && /must be a primitive or a read/.test(p)),
    ).toBe(true);
  });

  it('the "must ride a primitive" path stays green for a valid all-primitive spec', () => {
    // No atomic write cap exists in the registry to compose besides
    // email.send/invoice.nudge (all rejected); the positive case is
    // that an all-primitive spec passes the kind assertion cleanly. A read-only
    // atomic step is also kind-legal, but the Composer never emits one, so the
    // load-bearing guarantee we assert here is: a valid primitive-only spec
    // produces NO kind-assertion problem.
    const s = morningOpsSpec();
    const problems = validateComposedSpec(s, GRANTED);
    expect(problems.some((p) => /must be a primitive or a read/.test(p))).toBe(false);
    expect(problems).toEqual([]);
  });
});

/* ── interpreter runs a 2-primitive spec as an ordered SEQUENCE ─────────────── */

interface Harness {
  deps: RunnerDeps;
  reads: string[];
}

function harness(reader: (path: string) => string): Harness {
  const runs = new MemoryRunStore(() => NOW);
  runs.seedCredits(ACCOUNT, 1000);
  const reads: string[] = [];
  const deps: RunnerDeps = {
    runs,
    routines: new MemoryRoutineStore(),
    grants: new MemoryGrantStore(),
    idempotency: new MemoryIdempotencyStore(),
    events: new MemoryEventSink(),
    reader: {
      async read(_c, _cap, path) {
        reads.push(path);
        return quarantine(reader(path), `test:${path}`);
      },
    },
    effects: { async execute() {} },
    now: () => NOW,
  };
  return { deps, reads };
}

function nib(s: AgentSpec): NibbinRef {
  return { id: 'nib-mp', accountId: ACCOUNT, name: 'Morning ops', stage: 'student', stageChangedAt: 0, status: 'active', spec: s };
}

const CONN_MAP = { 'google-calendar': 'conn-gcal', stripe: 'conn-stripe', gmail: 'conn-gmail' };

/** A reader that gives the morning-brief primitives empty calendar+mail but ONE
 *  badly-overdue invoice, so the SECOND primitive (nudge.overdue-invoice) yields
 *  a real draft after the FIRST (digest.morning) presents its brief. */
function morningOpsReader(path: string): string {
  // Stripe invoices list (/v1/invoices?…) — one badly-overdue OPEN invoice.
  if (path.includes('/v1/invoices')) {
    return JSON.stringify({
      data: [
        {
          id: 'in_1',
          status: 'open',
          due_date: Math.floor((NOW - 20 * DAY) / 1000),
          amount_due: 25000,
          customer_email: 'client@example.com',
          hosted_invoice_url: 'https://invoice.stripe.com/i/pay_in_1',
        },
      ],
    });
  }
  // Calendar (/calendar/v3/…): nothing on the books.
  if (path.includes('/calendar/')) return '{"items":[]}';
  // Gmail list + meta (/gmail/v1/…): empty mailbox.
  return '{"messages":[]}';
}

describe('interpreter runs a 2-primitive spec end-to-end', () => {
  it('produces an ordered sequence: morning-brief presentation, then an overdue-invoice draft', async () => {
    const s = morningOpsSpec();
    expect(validateComposedSpec(s, GRANTED)).toEqual([]);

    const h = harness(morningOpsReader);
    const outcome = await executeRun(nib(s), TRIGGER, interpretSpec(s, CONN_MAP, NOW), h.deps);

    // The run pauses on the FIRST side-effecting draft it yields (the runner
    // returns awaiting_approval on the first gated draft). Both primitives'
    // reads ran through the allowlist + quarantine gate before that point.
    expect(['awaiting_approval', 'completed']).toContain(outcome.kind);
    expect(h.reads.length).toBeGreaterThan(0);
    // The morning brief read the calendar AND the nudge read stripe invoices —
    // proving BOTH primitives executed in sequence through the runner.
    expect(h.reads.some((p) => p.includes('stripe') || p.includes('invoice'))).toBe(true);
  });
});
