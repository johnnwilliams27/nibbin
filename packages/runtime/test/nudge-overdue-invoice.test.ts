/**
 * Task 4 — `nudge.overdue-invoice` CROSS-RESOURCE primitive end-to-end proof.
 *
 * Per the 2026-06-22 personalized-email decision the overdue-invoice nudge no
 * longer resends a Stripe-native invoice — it reads Stripe (payments.read) and
 * drafts a brand-voice payment-nudge EMAIL to the customer (email.send via
 * Gmail) carrying the real hosted_invoice_url pay link. Stripe stays read-only.
 *
 * Tests:
 *   1. primitive unit behaviour (direct generator) — recipient resolution, the
 *      pay link in the body, the no-email / no-overdue compose notes, and the
 *      polite pauses when stripe OR gmail is missing.
 *   2. the action-level matrix via real `executeRun` — observe → no output;
 *      draft → email.send draft recorded + native Gmail draft mirror created
 *      (email.send is nativeDraft:true); send → executor sends once behind
 *      idempotency.
 */
import { describe, expect, it } from 'vitest';
import { quarantine } from '@nibbin/connectors';
import {
  executeRun,
  nudgeOverdueInvoice,
  MemoryEventSink,
  MemoryGrantStore,
  MemoryIdempotencyStore,
  MemoryRoutineStore,
  MemoryRunStore,
  type AgentSpec,
  type NibbinRef,
  type ProgramFn,
  type RunnerDeps,
} from '../src/index';

const NOW_MS = 1_700_000_000_000;
const DAY = 86_400_000;

const ACCOUNT = 'acct-inv';
const STRIPE_CONN = 'stripe-conn-1';
const GMAIL_CONN = 'gmail-conn-1';
const TRIGGER = { kind: 'user' as const };

const OVERDUE_INVOICE = 'in_overdue';
const CUSTOMER_EMAIL = 'client@example.com';
const PAY_LINK = 'https://invoice.stripe.com/i/pay_overdue';

// ── Spec + NibbinRef builders ────────────────────────────────────────────────
const CURRICULUM = {
  measures: 'payment nudges approved without edits',
  promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95 },
  routineMinApprovals: 5,
};
const CREDIT = {
  weightClass: 'standard' as const,
  ceilings: { maxSteps: 120, maxTokens: 12_000, maxWallClockMs: 60_000 },
};

function tallySpec(over: Partial<AgentSpec> = {}): AgentSpec {
  return {
    templateKey: 'tally',
    version: 1,
    displayName: 'Tally',
    toolsAllowlist: ['payments.read', 'email.send'],
    requiredConnectors: ['stripe', 'gmail'],
    triggers: [{ kind: 'user' as const }],
    curriculum: CURRICULUM,
    creditProfile: CREDIT,
    steps: [{ capability: 'nudge.overdue-invoice', inputs: { minDaysLate: 0 } }],
    ...over,
  };
}

function nibRef(): NibbinRef {
  return {
    id: 'nib-inv',
    accountId: ACCOUNT,
    name: 'Tally',
    stage: 'student',
    stageChangedAt: 0,
    status: 'active',
    spec: tallySpec(),
  };
}

// ── Reader helpers ───────────────────────────────────────────────────────────
/** One overdue OPEN invoice, 20 days late, with a customer email + pay link. */
function overdueReader(over: Record<string, unknown> = {}) {
  return {
    async read(_c: string, _cap: string, _path: string) {
      return quarantine(
        JSON.stringify({
          data: [
            {
              id: OVERDUE_INVOICE,
              status: 'open',
              due_date: Math.floor((NOW_MS - 20 * DAY) / 1000),
              amount_due: 24_900,
              customer_email: CUSTOMER_EMAIL,
              hosted_invoice_url: PAY_LINK,
              ...over,
            },
          ],
        }),
        'stripe:invoices:test',
      );
    },
  };
}

/** No overdue invoices (all paid). */
function emptyReader() {
  return {
    async read(_c: string, _cap: string, _path: string) {
      return quarantine(JSON.stringify({ data: [] }), 'stripe:invoices:empty');
    },
  };
}

// ── Harness ──────────────────────────────────────────────────────────────────
function harness(reader?: { read(c: string, cap: string, path: string): Promise<ReturnType<typeof quarantine>> }) {
  const runs = new MemoryRunStore(() => NOW_MS);
  runs.seedCredits(ACCOUNT, 1000);
  const deps: RunnerDeps = {
    runs,
    routines: new MemoryRoutineStore(),
    grants: new MemoryGrantStore(),
    idempotency: new MemoryIdempotencyStore(),
    events: new MemoryEventSink(),
    reader: reader ?? overdueReader(),
    effects: { async execute() {} },
    now: () => NOW_MS,
  };
  return { deps, runs };
}

function invoiceNib(actionLevel: 'observe' | 'draft' | 'act'): { h: ReturnType<typeof harness>; nib: NibbinRef } {
  const h = harness();
  h.runs.nibbinState('nib-inv').actionLevel = actionLevel;
  return { h, nib: nibRef() };
}

function invoiceProgram(opts: { minDaysLate?: number } = {}): ProgramFn {
  return nudgeOverdueInvoice(
    { minDaysLate: opts.minDaysLate ?? 0 },
    { stripe: STRIPE_CONN, gmail: GMAIL_CONN },
    NOW_MS,
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Primitive unit tests (direct generator invocation)
// ════════════════════════════════════════════════════════════════════════════
describe('nudge.overdue-invoice — primitive unit', () => {
  it('throws politely when stripe connection is missing', async () => {
    const fn = nudgeOverdueInvoice({}, { gmail: GMAIL_CONN }, NOW_MS);
    const gen = fn({ nibbin: nibRef(), trigger: TRIGGER });
    await expect(gen.next()).rejects.toThrow('no active stripe connection');
  });

  it('throws politely when gmail connection is missing', async () => {
    const fn = nudgeOverdueInvoice({}, { stripe: STRIPE_CONN }, NOW_MS);
    const gen = fn({ nibbin: nibRef(), trigger: TRIGGER });
    await expect(gen.next()).rejects.toThrow('no active gmail connection');
  });

  it('overdue invoice WITH customer_email → emits an email.send draft with the pay link + safe recipient', async () => {
    const fn = nudgeOverdueInvoice({ minDaysLate: 0 }, { stripe: STRIPE_CONN, gmail: GMAIL_CONN }, NOW_MS);
    const gen = fn({ nibbin: nibRef(), trigger: TRIGGER });

    // Step 1: the read on the stripe connection.
    const readResult = await gen.next();
    expect(readResult.done).toBe(false);
    const readStep = readResult.value as { kind: string; capability: string; connectionId: string; path: string };
    expect(readStep.kind).toBe('read');
    expect(readStep.capability).toBe('payments.read');
    expect(readStep.connectionId).toBe(STRIPE_CONN);
    expect(readStep.path).toContain('/v1/invoices');

    const payload = quarantine(
      JSON.stringify({
        data: [
          {
            id: OVERDUE_INVOICE,
            status: 'open',
            due_date: Math.floor((NOW_MS - 20 * DAY) / 1000),
            amount_due: 24_900,
            customer_email: CUSTOMER_EMAIL,
            hosted_invoice_url: PAY_LINK,
          },
        ],
      }),
      'stripe:invoices:unit',
    );

    // Step 2: the email.send draft on the gmail connection.
    const draftResult = await gen.next(payload);
    expect(draftResult.done).toBe(false);
    const draft = draftResult.value as unknown as {
      kind: string;
      capability: string;
      connectionId: string;
      patternKey: string;
      title: string;
      draft: string;
      effectArgs: Record<string, unknown>;
    };
    expect(draft.kind).toBe('draft');
    expect(draft.capability).toBe('email.send');
    expect(draft.connectionId).toBe(GMAIL_CONN);
    expect(draft.patternKey).toBe('email.send:invoice-nudge');
    // The dollar amount + days-late title is preserved.
    expect(draft.title).toContain('$249');
    expect(draft.title).toContain('20 days past due');
    // The pay link rides the body so the client can pay.
    expect(draft.draft).toContain(PAY_LINK);
    // effectArgs: {invoiceId, to} (the safeAddress'd customer email).
    expect(draft.effectArgs).toEqual({ invoiceId: OVERDUE_INVOICE, to: CUSTOMER_EMAIL });
    // No reserved keys.
    expect(draft.effectArgs.nativeDraft).toBeUndefined();
    expect(draft.effectArgs.nativeDraftRef).toBeUndefined();
    expect(draft.effectArgs.dismiss).toBeUndefined();

    const done = await gen.next();
    expect(done.done).toBe(true);
  });

  it('overdue invoice WITHOUT a usable customer email → compose note, no draft', async () => {
    const fn = nudgeOverdueInvoice({ minDaysLate: 0 }, { stripe: STRIPE_CONN, gmail: GMAIL_CONN }, NOW_MS);
    const gen = fn({ nibbin: nibRef(), trigger: TRIGGER });
    await gen.next(); // read

    const payload = quarantine(
      JSON.stringify({
        data: [
          {
            id: OVERDUE_INVOICE,
            status: 'open',
            due_date: Math.floor((NOW_MS - 20 * DAY) / 1000),
            amount_due: 24_900,
            customer_email: null,
            hosted_invoice_url: PAY_LINK,
          },
        ],
      }),
      'stripe:invoices:no-email',
    );

    const result = await gen.next(payload);
    expect(result.done).toBe(false);
    const compose = result.value as { kind: string; payload: { note: string } };
    expect(compose.kind).toBe('compose');
    expect(compose.payload.note).toMatch(/no customer email/);

    const done = await gen.next();
    expect(done.done).toBe(true);
  });

  it('overdue invoice with a non-Stripe / malicious pay link → compose note, no send (red-team P1)', async () => {
    for (const badUrl of ['javascript:alert(1)', 'https://evil.example.com/pay', 'data:text/html,x', 'http://invoice.stripe.com/i/x', 'https://stripe.com.evil.com/p', 'not-a-url']) {
      const fn = nudgeOverdueInvoice({ minDaysLate: 0 }, { stripe: STRIPE_CONN, gmail: GMAIL_CONN }, NOW_MS);
      const gen = fn({ nibbin: nibRef(), trigger: TRIGGER });
      await gen.next(); // read
      const payload = quarantine(
        JSON.stringify({
          data: [
            {
              id: OVERDUE_INVOICE,
              status: 'open',
              due_date: Math.floor((NOW_MS - 20 * DAY) / 1000),
              amount_due: 24_900,
              customer_email: CUSTOMER_EMAIL,
              hosted_invoice_url: badUrl,
            },
          ],
        }),
        'stripe:invoices:badurl',
      );
      const result = await gen.next(payload);
      const compose = result.value as { kind: string; payload: { note: string } };
      expect(compose.kind, `bad url "${badUrl}" must NOT produce a send`).toBe('compose');
      expect(compose.payload.note).toMatch(/no valid Stripe payment link/);
    }
  });

  it('overdue invoice with an empty/missing pay link → compose note, no send (logic P2)', async () => {
    const fn = nudgeOverdueInvoice({ minDaysLate: 0 }, { stripe: STRIPE_CONN, gmail: GMAIL_CONN }, NOW_MS);
    const gen = fn({ nibbin: nibRef(), trigger: TRIGGER });
    await gen.next(); // read
    const payload = quarantine(
      JSON.stringify({
        data: [
          {
            id: OVERDUE_INVOICE,
            status: 'open',
            due_date: Math.floor((NOW_MS - 20 * DAY) / 1000),
            amount_due: 24_900,
            customer_email: CUSTOMER_EMAIL,
            hosted_invoice_url: null,
          },
        ],
      }),
      'stripe:invoices:emptyurl',
    );
    const result = await gen.next(payload);
    const compose = result.value as { kind: string; payload: { note: string } };
    expect(compose.kind).toBe('compose');
    expect(compose.payload.note).toMatch(/no valid Stripe payment link/);
  });

  it('no overdue invoices → compose note, no draft', async () => {
    const fn = nudgeOverdueInvoice({ minDaysLate: 0 }, { stripe: STRIPE_CONN, gmail: GMAIL_CONN }, NOW_MS);
    const gen = fn({ nibbin: nibRef(), trigger: TRIGGER });
    await gen.next(); // read

    const payload = quarantine(JSON.stringify({ data: [] }), 'stripe:invoices:empty-unit');
    const result = await gen.next(payload);
    expect(result.done).toBe(false);
    const compose = result.value as { kind: string; payload: { note: string } };
    expect(compose.kind).toBe('compose');
    expect(compose.payload.note).toMatch(/no overdue/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Action-level matrix via executeRun (email.send is nativeDraft:true)
// ════════════════════════════════════════════════════════════════════════════
describe('nudge.overdue-invoice — action-level matrix (email.send rail)', () => {
  it('observe → killed:observe — no draft recorded, no effect', async () => {
    const { h, nib } = invoiceNib('observe');
    h.deps.reader = overdueReader();
    let executions = 0;
    h.deps.effects = { async execute() { executions += 1; } };

    const outcome = await executeRun(nib, TRIGGER, invoiceProgram(), h.deps);
    expect(outcome.kind).toBe('killed');
    expect((outcome as { reason: string }).reason).toBe('observe');
    expect(executions).toBe(0);

    const runId = (outcome as { runId: string }).runId;
    const draftRows = h.runs.getSteps(runId).filter((s) => s.kind === 'draft');
    expect(draftRows).toHaveLength(0);
  });

  it('draft → awaiting_approval — email.send draft recorded + native Gmail draft mirror created (nativeDraft:true)', async () => {
    const { h, nib } = invoiceNib('draft');
    h.deps.reader = overdueReader();
    // email.send is nativeDraft:true → the runner calls execute({nativeDraft:true})
    // at DRAFT time to create the Gmail draft mirror, then records the ref.
    const nativeDraftCalls: Array<Record<string, unknown>> = [];
    h.deps.effects = {
      async execute(req) {
        if (req.capability === 'email.send' && (req.args as { nativeDraft?: boolean }).nativeDraft === true) {
          nativeDraftCalls.push(req.args);
          return { nativeDraftId: 'gmail-draft-xyz' };
        }
        throw new Error('unexpected non-native-draft execute at draft level');
      },
    };

    const outcome = await executeRun(nib, TRIGGER, invoiceProgram(), h.deps);
    expect(outcome.kind).toBe('awaiting_approval');

    // Exactly one native-draft mirror call.
    expect(nativeDraftCalls).toHaveLength(1);

    const runId = (outcome as { runId: string }).runId;
    const draftRows = h.runs.getSteps(runId).filter((s) => s.kind === 'draft');
    expect(draftRows).toHaveLength(1);
    expect(draftRows[0].tool).toBe('email.send');
    // The native-draft ref was persisted on the step.
    expect(draftRows[0].payload?.nativeDraftRef).toBe('gmail-draft-xyz');
  });

  it('send → executed — effects executor sends exactly once with the invoice recipient', async () => {
    const { h, nib } = invoiceNib('act');
    h.deps.reader = overdueReader();
    const sendCalls: Array<Record<string, unknown>> = [];
    h.deps.effects = {
      async execute(req) {
        if (req.capability === 'email.send' && (req.args as { nativeDraft?: boolean }).nativeDraft === true) {
          return { nativeDraftId: 'gmail-draft-send' };
        }
        if (req.capability === 'email.send') sendCalls.push(req.args);
      },
    };

    const outcome = await executeRun(nib, TRIGGER, invoiceProgram(), h.deps);
    expect(outcome.kind).toBe('executed');
    // Exactly one real send (the native-draft mirror is a separate call namespace).
    expect(sendCalls).toHaveLength(1);
    expect((sendCalls[0] as { to?: string }).to).toBe(CUSTOMER_EMAIL);
  });

  it('send with replayed trigger → idempotency holds — send fires exactly once', async () => {
    const { h, nib } = invoiceNib('act');
    h.deps.reader = overdueReader();
    let sends = 0;
    h.deps.effects = {
      async execute(req) {
        if (req.capability === 'email.send' && (req.args as { nativeDraft?: boolean }).nativeDraft === true) {
          return { nativeDraftId: 'd' };
        }
        if (req.capability === 'email.send') sends += 1;
      },
    };

    const sameEvent = { kind: 'event' as const, key: 'stripe:overdue', dedupeKey: 'inv-evt-1' };
    const first = await executeRun(nib, sameEvent, invoiceProgram(), h.deps);
    expect(first.kind).toBe('executed');
    expect(sends).toBe(1);

    const replaySpec = tallySpec({
      triggers: [{ kind: 'event' as const, source: 'connector:stripe:invoice.overdue', debounceSecs: 0, cooldownSecs: 0 }],
    });
    const again = await executeRun({ ...nib, spec: replaySpec }, sameEvent, invoiceProgram(), h.deps);
    expect(again.kind).toBe('executed');
    expect(sends).toBe(1); // idempotency wall held
  });

  it('no overdue invoices → completes with no draft step even at send level', async () => {
    const { h, nib } = invoiceNib('act');
    h.deps.reader = emptyReader();
    let executions = 0;
    h.deps.effects = { async execute() { executions += 1; } };

    const outcome = await executeRun(nib, TRIGGER, invoiceProgram(), h.deps);
    expect(outcome.kind).toBe('completed'); // compose note → no draft → completed
    expect(executions).toBe(0);
  });
});
