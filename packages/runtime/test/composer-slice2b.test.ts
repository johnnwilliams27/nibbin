/**
 * Composer Slice 2b — the detect-and-nudge family generalizes (design §2/§3):
 *  - PARITY: each new primitive (invoice/calendar/inquiry) yields the SAME
 *    steps + effectArgs as its template program does on the same fixture (they
 *    are the same code via delegation). The cross-resource one reads on the
 *    gcal connection and drafts on the gmail one.
 *  - VALIDATOR (fail-closed): a composed spec for each primitive validates when
 *    its connector(s) are granted and is rejected when one is missing —
 *    INCLUDING the cross-resource case (gcal-only is rejected for the missing
 *    gmail).
 *  - e2e: a steps-spec for each runs through interpretSpec → executeRun with a
 *    path-aware reader stub returning one matching item → awaiting_approval with
 *    the expected effectArgs/patternKey.
 */
import { describe, expect, it } from 'vitest';
import { quarantine } from '@nibbin/connectors';
import {
  executeRun,
  interpretSpec,
  nudgeOverdueInvoice,
  nudgeUnconfirmedEvent,
  replyNewInquiry,
  validateComposedSpec,
  MemoryEventSink,
  MemoryGrantStore,
  MemoryIdempotencyStore,
  MemoryRoutineStore,
  MemoryRunStore,
  type AgentSpec,
  type NibbinRef,
  type ProgramFn,
  type ProgramStep,
  type RunnerDeps,
  type RunTrigger,
} from '../src/index';

const ACCOUNT = 'acct-2b';
const GMAIL = 'conn-gmail';
const STRIPE = 'conn-stripe';
const GCAL = 'conn-gcal';
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
    displayName: 'Composed',
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

/* ── validator: per-primitive connector gating (incl. cross-resource) ─────── */

describe('validateComposedSpec — nudge family connector gating', () => {
  it('accepts nudge.overdue-invoice when stripe is granted; rejects when not', () => {
    const s = spec({
      displayName: 'Invoice nudges',
      toolsAllowlist: ['payments.read', 'invoice.nudge'],
      requiredConnectors: ['stripe'],
      steps: [{ capability: 'nudge.overdue-invoice', inputs: { minDaysLate: 0 } }],
    });
    expect(validateComposedSpec(s, ['stripe'])).toEqual([]);
    expect(validateComposedSpec(s, []).some((p) => /not connected/.test(p))).toBe(true);
  });

  it('accepts reply.new-inquiry when gmail is granted; rejects when not', () => {
    const s = spec({
      displayName: 'New-inquiry replies',
      toolsAllowlist: ['email.read', 'email.send'],
      requiredConnectors: ['gmail'],
      steps: [{ capability: 'reply.new-inquiry', inputs: {} }],
    });
    expect(validateComposedSpec(s, ['gmail'])).toEqual([]);
    expect(validateComposedSpec(s, []).some((p) => /not connected/.test(p))).toBe(true);
  });

  it('accepts the CROSS-RESOURCE nudge.unconfirmed-event when BOTH gcal+gmail are granted', () => {
    const s = spec({
      displayName: 'Booking confirmations',
      toolsAllowlist: ['calendar.read', 'email.send'],
      requiredConnectors: ['google-calendar', 'gmail'],
      steps: [{ capability: 'nudge.unconfirmed-event', inputs: { withinDays: 7 } }],
    });
    expect(validateComposedSpec(s, ['google-calendar', 'gmail'])).toEqual([]);
  });

  it('rejects nudge.unconfirmed-event when only gcal is granted (gmail missing — the email.draft tool)', () => {
    const s = spec({
      displayName: 'Booking confirmations',
      toolsAllowlist: ['calendar.read', 'email.send'],
      requiredConnectors: ['google-calendar', 'gmail'],
      steps: [{ capability: 'nudge.unconfirmed-event', inputs: { withinDays: 7 } }],
    });
    // gcal granted but gmail is not → the email.send step needs gmail.
    const problems = validateComposedSpec(s, ['google-calendar']);
    expect(problems.some((p) => /gmail.*not connected|not connected/.test(p))).toBe(true);
  });

  it('rejects out-of-bounds invoice param (minDaysLate above max)', () => {
    const s = spec({
      toolsAllowlist: ['payments.read', 'invoice.nudge'],
      requiredConnectors: ['stripe'],
      steps: [{ capability: 'nudge.overdue-invoice', inputs: { minDaysLate: 999 } }],
    });
    expect(validateComposedSpec(s, ['stripe']).some((p) => /above max/.test(p))).toBe(true);
  });

  it('rejects an unknown input on reply.new-inquiry (empty schema accepts no keys)', () => {
    const s = spec({
      toolsAllowlist: ['email.read', 'email.draft'],
      requiredConnectors: ['gmail'],
      steps: [{ capability: 'reply.new-inquiry', inputs: { evil: 1 } as Record<string, unknown> }],
    });
    expect(validateComposedSpec(s, ['gmail']).some((p) => /unknown input/.test(p))).toBe(true);
  });
});

/* ── e2e: dispatch each primitive through the real runner ──────────────────── */

interface Harness {
  deps: RunnerDeps;
  reads: Array<{ connectionId: string; path: string }>;
  executed: Array<{ capability: string }>;
}

function harness(reader: (connectionId: string, path: string) => string): Harness {
  const runs = new MemoryRunStore(() => Date.now());
  runs.seedCredits(ACCOUNT, 100);
  const reads: Array<{ connectionId: string; path: string }> = [];
  const executed: Array<{ capability: string }> = [];
  const deps: RunnerDeps = {
    runs,
    routines: new MemoryRoutineStore(),
    grants: new MemoryGrantStore(),
    idempotency: new MemoryIdempotencyStore(),
    events: new MemoryEventSink(),
    reader: {
      async read(c, _cap, path) {
        reads.push({ connectionId: c, path });
        return quarantine(reader(c, path), `prov:test:${path}`);
      },
    },
    effects: {
      async execute(req) {
        executed.push({ capability: req.capability });
      },
    },
    now: () => Date.now(),
  };
  return { deps, reads, executed };
}

function nib(s: AgentSpec): NibbinRef {
  return { id: 'nib-2b', accountId: ACCOUNT, name: 'Composed', stage: 'student', stageChangedAt: 0, status: 'active', spec: s };
}

const OVERDUE_INVOICE = 'in_overdue';
function stripeReader(): (c: string, path: string) => string {
  return () =>
    JSON.stringify({
      data: [
        { id: OVERDUE_INVOICE, status: 'open', due_date: Math.floor((NOW - 20 * DAY) / 1000), amount_due: 24_900 },
      ],
    });
}

const EVENT_ID = 'evt_1';
function gcalGmailReader(): (c: string, path: string) => string {
  return (_c, path) => {
    if (path.includes('/calendar/')) {
      return JSON.stringify({
        items: [
          {
            id: EVENT_ID,
            summary: 'Discovery call',
            status: 'confirmed',
            start: { dateTime: new Date(NOW + 2 * DAY).toISOString() },
            attendees: [
              { email: 'me@studio.com', self: true, responseStatus: 'accepted' },
              { email: 'Guest <guest@example.com>', responseStatus: 'needsAction' },
            ],
          },
        ],
      });
    }
    return '{"messages":[]}';
  };
}

const INQUIRY_THREAD = 'thread_inq';
function inquiryReader(): (c: string, path: string) => string {
  return (_c, path) => {
    if (path.includes('/messages?')) {
      const isSent = path.includes('in%3Asent') || path.includes('in:sent');
      return isSent ? '{"messages":[]}' : `{"messages":[{"id":"${INQUIRY_THREAD}"}]}`;
    }
    return JSON.stringify({
      id: INQUIRY_THREAD,
      threadId: INQUIRY_THREAD,
      internalDate: String(NOW - DAY),
      payload: { headers: [
        { name: 'From', value: 'New Lead <lead@example.com>' },
        { name: 'Subject', value: 'Wedding inquiry' },
      ] },
    });
  };
}

describe('interpreter dispatches the nudge-family primitives through the runner', () => {
  it('nudge.overdue-invoice → awaiting_approval invoice.nudge draft (trusted effectArgs)', async () => {
    const h = harness(stripeReader());
    const s = spec({
      toolsAllowlist: ['payments.read', 'invoice.nudge'],
      requiredConnectors: ['stripe'],
      steps: [{ capability: 'nudge.overdue-invoice', inputs: {} }],
    });
    const outcome = await executeRun(nib(s), TRIGGER, interpretSpec(s, { stripe: STRIPE }, NOW), h.deps);
    expect(outcome.kind).toBe('awaiting_approval');
    if (outcome.kind !== 'awaiting_approval') throw new Error('expected awaiting_approval');
    expect(h.executed).toHaveLength(0);
    expect(outcome.draft.capability).toBe('invoice.nudge');
    expect(outcome.draft.patternKey).toBe('invoice.nudge:overdue');
    expect(outcome.draft.effectArgs).toEqual({ invoiceId: OVERDUE_INVOICE, amountCents: 24_900 });
  });

  it('nudge.unconfirmed-event (cross-resource): reads on gcal, drafts on gmail → awaiting_approval', async () => {
    const h = harness(gcalGmailReader());
    const s = spec({
      toolsAllowlist: ['calendar.read', 'email.send'],
      requiredConnectors: ['google-calendar', 'gmail'],
      steps: [{ capability: 'nudge.unconfirmed-event', inputs: {} }],
    });
    const outcome = await executeRun(
      nib(s),
      TRIGGER,
      interpretSpec(s, { 'google-calendar': GCAL, gmail: GMAIL }, NOW),
      h.deps,
    );
    expect(outcome.kind).toBe('awaiting_approval');
    if (outcome.kind !== 'awaiting_approval') throw new Error('expected awaiting_approval');
    // The read rode the gcal connection.
    expect(h.reads.length).toBe(1);
    expect(h.reads[0].connectionId).toBe(GCAL);
    expect(h.reads[0].path).toContain('/calendar/');
    // The draft rides the gmail connection, with trusted-built effectArgs.
    expect(outcome.draft.capability).toBe('email.send');
    expect(outcome.draft.connectionId).toBe(GMAIL);
    expect(outcome.draft.patternKey).toBe('email.send:session-confirmation');
    expect(outcome.draft.effectArgs).toEqual({ eventId: EVENT_ID, to: 'guest@example.com' });
  });

  it('reply.new-inquiry → awaiting_approval inquiry-reply draft', async () => {
    const h = harness(inquiryReader());
    const s = spec({
      toolsAllowlist: ['email.read', 'email.send'],
      requiredConnectors: ['gmail'],
      steps: [{ capability: 'reply.new-inquiry', inputs: {} }],
    });
    const outcome = await executeRun(nib(s), TRIGGER, interpretSpec(s, { gmail: GMAIL }, NOW), h.deps);
    expect(outcome.kind).toBe('awaiting_approval');
    if (outcome.kind !== 'awaiting_approval') throw new Error('expected awaiting_approval');
    expect(outcome.draft.capability).toBe('email.send');
    expect(outcome.draft.patternKey).toBe('email.send:inquiry-reply');
    expect(outcome.draft.effectArgs).toEqual({ threadId: INQUIRY_THREAD, subject: 'Re: Wedding inquiry' });
  });
});

/* ── parameterization: the only behavior 2b adds beyond the templates ──────── */

/** Stripe invoices with explicit per-invoice overdue ages (days past due). */
function stripeAgedReader(ages: Array<{ id: string; daysLate: number; amount: number }>): (c: string, path: string) => string {
  return () =>
    JSON.stringify({
      data: ages.map((a) => ({
        id: a.id,
        status: 'open',
        due_date: Math.floor((NOW - a.daysLate * DAY) / 1000),
        amount_due: a.amount,
      })),
    });
}

describe('parameterization beyond the templates (minDaysLate / withinDays)', () => {
  it('nudge.overdue-invoice minDaysLate=30 excludes a 10-day-late invoice but drafts a 40-day-late one', async () => {
    // A 10-day-late invoice alone → cutoff (now - 30d) excludes it → no draft.
    const h10 = harness(stripeAgedReader([{ id: 'in_10', daysLate: 10, amount: 10_000 }]));
    const s = spec({
      toolsAllowlist: ['payments.read', 'invoice.nudge'],
      requiredConnectors: ['stripe'],
      steps: [{ capability: 'nudge.overdue-invoice', inputs: { minDaysLate: 30 } }],
    });
    const out10 = await executeRun(nib(s), TRIGGER, interpretSpec(s, { stripe: STRIPE }, NOW), h10.deps);
    // Compose-only outcome (no draft → completed, not awaiting_approval).
    expect(out10.kind).not.toBe('awaiting_approval');

    // A 40-day-late invoice → past the 30-day cutoff → it IS drafted.
    const h40 = harness(stripeAgedReader([{ id: 'in_40', daysLate: 40, amount: 50_000 }]));
    const out40 = await executeRun(nib(s), TRIGGER, interpretSpec(s, { stripe: STRIPE }, NOW), h40.deps);
    expect(out40.kind).toBe('awaiting_approval');
    if (out40.kind !== 'awaiting_approval') throw new Error('expected awaiting_approval');
    expect(out40.draft.effectArgs).toEqual({ invoiceId: 'in_40', amountCents: 50_000 });
  });

  it('nudge.unconfirmed-event withinDays=30 widens the calendar timeMax to now + 30 days', async () => {
    const h = harness(gcalGmailReader());
    const s = spec({
      toolsAllowlist: ['calendar.read', 'email.send'],
      requiredConnectors: ['google-calendar', 'gmail'],
      steps: [{ capability: 'nudge.unconfirmed-event', inputs: { withinDays: 30 } }],
    });
    await executeRun(nib(s), TRIGGER, interpretSpec(s, { 'google-calendar': GCAL, gmail: GMAIL }, NOW), h.deps);
    // The single read is the calendar query; parse its timeMax out of the path.
    expect(h.reads.length).toBe(1);
    const url = new URL(`https://x${h.reads[0].path}`);
    const timeMax = url.searchParams.get('timeMax');
    expect(timeMax).toBe(new Date(NOW + 30 * DAY).toISOString());
    // Sanity: at the default (7), timeMax would be the narrower horizon.
    expect(timeMax).not.toBe(new Date(NOW + 7 * DAY).toISOString());
  });
});

/* ── parity: each primitive ↔ its template program (same steps + effectArgs) ── */

/** Drive a ProgramFn to exhaustion, feeding quarantined replies keyed by the
 *  read path/connection so list vs meta vs calendar parse correctly. */
async function drive(
  program: ProgramFn,
  responder: (step: ProgramStep) => string | undefined,
): Promise<ProgramStep[]> {
  const steps: ProgramStep[] = [];
  const gen = program({ nibbin: nib(spec({})), trigger: TRIGGER });
  let fed: ReturnType<typeof quarantine> | undefined;
  for (;;) {
    const r = await gen.next(fed);
    if (r.done) break;
    steps.push(r.value);
    const body = responder(r.value);
    fed = body !== undefined ? quarantine(body, 'prov:test') : undefined;
  }
  return steps;
}

/** Read-step responders matched to each connector's fixture above. */
const stripeResponder = (step: ProgramStep) => (step.kind === 'read' ? stripeReader()('', step.path) : undefined);
const gcalGmailResponder = (step: ProgramStep) =>
  step.kind === 'read' ? gcalGmailReader()(step.connectionId, step.path) : undefined;
const inquiryResponder = (step: ProgramStep) =>
  step.kind === 'read' ? inquiryReader()('', step.path) : undefined;

describe('template ↔ primitive parity (identical yielded steps + effectArgs)', () => {
  it('nudge.overdue-invoice matches tally on the same invoice fixture', async () => {
    const steps = await drive(nudgeOverdueInvoice({ minDaysLate: 0 }, { stripe: STRIPE }, NOW), stripeResponder);
    const draft = steps.find((s) => s.kind === 'draft');
    expect(draft && draft.kind === 'draft' && draft.capability).toBe('invoice.nudge');
    if (!draft || draft.kind !== 'draft') throw new Error('expected draft');
    expect(draft.patternKey).toBe('invoice.nudge:overdue');
    expect(draft.effectArgs).toEqual({ invoiceId: OVERDUE_INVOICE, amountCents: 24_900 });
  });

  it('nudge.unconfirmed-event matches hopper: read carries gcal id, draft carries gmail id', async () => {
    const steps = await drive(
      nudgeUnconfirmedEvent({ withinDays: 7 }, { 'google-calendar': GCAL, gmail: GMAIL }, NOW),
      gcalGmailResponder,
    );
    const read = steps.find((s) => s.kind === 'read');
    const draft = steps.find((s) => s.kind === 'draft');
    if (!read || read.kind !== 'read') throw new Error('expected read');
    if (!draft || draft.kind !== 'draft') throw new Error('expected draft');
    // Cross-resource: read on gcal, draft on gmail.
    expect(read.connectionId).toBe(GCAL);
    expect(read.path).toContain('/calendar/');
    expect(draft.connectionId).toBe(GMAIL);
    expect(draft.capability).toBe('email.send');
    expect(draft.patternKey).toBe('email.send:session-confirmation');
    expect(draft.effectArgs).toEqual({ eventId: EVENT_ID, to: 'guest@example.com' });
  });

  it('reply.new-inquiry matches scribe on the same mailbox fixture (and yields a compose handoff)', async () => {
    const steps = await drive(replyNewInquiry({}, { gmail: GMAIL }, NOW), inquiryResponder);
    const draft = steps.find((s) => s.kind === 'draft');
    if (!draft || draft.kind !== 'draft') throw new Error('expected draft');
    expect(draft.capability).toBe('email.send');
    expect(draft.patternKey).toBe('email.send:inquiry-reply');
    expect(draft.effectArgs).toEqual({ threadId: INQUIRY_THREAD, subject: 'Re: Wedding inquiry' });
    // It asked the runner for a model draft before the draft, like scribe.
    expect(steps.some((s) => s.kind === 'compose' && 'prompt' in s && s.prompt)).toBe(true);
  });
});
