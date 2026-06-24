/**
 * Task 5a — the re-nudge floor end-to-end through `executeRun`.
 *
 * Proves the three required behaviours on the real dispatch path at the `act`
 * (Send) action level:
 *   1. A re-nudge of the SAME still-overdue invoice within the cadence is
 *      SKIPPED (run completes, no second send), regardless of trigger frequency.
 *   2. A first nudge records to the ledger and sends exactly once.
 *   3. The hard COUNT cap bounds re-nudging even past the interval.
 *   4. Stripe auto-dunning coordination: the primitive defers (no send) when
 *      Stripe's own automatic reminders are active on the invoice.
 *   5. Fail-open: a floor-store history throw still sends (the bound degrading
 *      never drops a legit nudge).
 *   6. The floor only touches NUDGE sends — an ordinary thread reply is untouched.
 */
import { describe, expect, it } from 'vitest';
import { quarantine } from '@nibbin/connectors';
import {
  executeRun,
  nudgeOverdueInvoice,
  MemoryEventSink,
  MemoryGrantStore,
  MemoryIdempotencyStore,
  MemoryNudgeFloorStore,
  MemoryRoutineStore,
  MemoryRunStore,
  FLOOR_MIN_INTERVAL_MS,
  type AgentSpec,
  type NibbinRef,
  type ProgramFn,
  type RunnerDeps,
} from '../src/index';

const NOW_MS = 1_700_000_000_000;
const DAY = 86_400_000;
const ACCOUNT = 'acct-floor';
const NIB_ID = 'nib-floor';
const STRIPE_CONN = 'stripe-conn';
const GMAIL_CONN = 'gmail-conn';
const INVOICE = 'in_overdue_1';
const TRIGGER = { kind: 'schedule' as const, key: 'daily.morning' };

const CURRICULUM = {
  measures: 'payment nudges approved without edits',
  promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95 },
  routineMinApprovals: 5,
};
const CREDIT = {
  weightClass: 'standard' as const,
  ceilings: { maxSteps: 120, maxTokens: 12_000, maxWallClockMs: 60_000 },
};

function tallySpec(): AgentSpec {
  return {
    templateKey: 'tally',
    version: 1,
    displayName: 'Tally',
    toolsAllowlist: ['payments.read', 'email.send'],
    requiredConnectors: ['stripe', 'gmail'],
    triggers: [{ kind: 'schedule' as const, schedule: 'daily.morning' }],
    curriculum: CURRICULUM,
    creditProfile: CREDIT,
    steps: [{ capability: 'nudge.overdue-invoice', inputs: { minDaysLate: 0 } }],
  };
}

function nibRef(): NibbinRef {
  return {
    id: NIB_ID,
    accountId: ACCOUNT,
    name: 'Tally',
    stage: 'student',
    stageChangedAt: 0,
    status: 'active',
    spec: tallySpec(),
  };
}

/** A reader returning one overdue OPEN invoice (extra fields overridable). */
function overdueReader(over: Record<string, unknown> = {}) {
  return {
    async read(_c: string, _cap: string, _path: string) {
      return quarantine(
        JSON.stringify({
          data: [
            {
              id: INVOICE,
              status: 'open',
              due_date: Math.floor((NOW_MS - 20 * DAY) / 1000),
              amount_due: 24_900,
              customer_email: 'client@example.com',
              hosted_invoice_url: 'https://invoice.stripe.com/i/pay_1',
              ...over,
            },
          ],
        }),
        'stripe:invoices:floor-test',
      );
    },
  };
}

function makeHarness(opts: {
  reader?: { read(c: string, cap: string, path: string): Promise<ReturnType<typeof quarantine>> };
  nudgeFloor?: RunnerDeps['nudgeFloor'];
  now?: () => number;
}) {
  const now = opts.now ?? (() => NOW_MS);
  const runs = new MemoryRunStore(now);
  runs.seedCredits(ACCOUNT, 10_000);
  runs.nibbinState(NIB_ID).actionLevel = 'act';
  const sends: Array<Record<string, unknown>> = [];
  const deps: RunnerDeps = {
    runs,
    routines: new MemoryRoutineStore(),
    grants: new MemoryGrantStore(),
    idempotency: new MemoryIdempotencyStore(),
    events: new MemoryEventSink(),
    reader: opts.reader ?? overdueReader(),
    effects: {
      async execute(req) {
        if (req.capability === 'email.send') sends.push(req.args);
      },
    },
    nudgeFloor: opts.nudgeFloor,
    now,
  };
  return { deps, runs, sends };
}

function program(inputs: { minDaysLate?: number; cadenceEveryDays?: number; cadenceMaxNudges?: number } = {}): ProgramFn {
  return nudgeOverdueInvoice(inputs, { stripe: STRIPE_CONN, gmail: GMAIL_CONN }, NOW_MS);
}

describe('re-nudge floor — end-to-end through executeRun (act level)', () => {
  it('first nudge sends once AND records to the ledger', async () => {
    const floor = new MemoryNudgeFloorStore();
    const { deps, sends } = makeHarness({ nudgeFloor: floor });
    const outcome = await executeRun(nibRef(), TRIGGER, program(), deps);
    expect(outcome.kind).toBe('executed');
    expect(sends).toHaveLength(1);
    const history = await floor.history(NIB_ID, 'invoice', INVOICE, 0);
    expect(history).toHaveLength(1);
  });

  it('re-nudge of the same invoice within the floor is SKIPPED — no second send', async () => {
    const floor = new MemoryNudgeFloorStore();
    // a nudge happened 1 day ago — inside the 3-day hard floor
    floor.seed(NIB_ID, 'invoice', INVOICE, NOW_MS - 1 * DAY);
    const { deps, sends } = makeHarness({ nudgeFloor: floor });
    const outcome = await executeRun(nibRef(), TRIGGER, program(), deps);
    expect(outcome.kind).toBe('completed');
    expect(outcome).toMatchObject({ nudgeSkipped: { reason: 'too_soon', floor: true } });
    expect(sends).toHaveLength(0);
    // no new ledger row (the send was skipped)
    expect(await floor.history(NIB_ID, 'invoice', INVOICE, 0)).toHaveLength(1);
  });

  it('daily scheduled ticks over an overdue invoice lifetime never spam — bounded by the count cap', async () => {
    const floor = new MemoryNudgeFloorStore();
    const sends: Array<Record<string, unknown>> = [];
    const sharedEffects = {
      async execute(req: { capability: string; args: Record<string, unknown> }) {
        if (req.capability === 'email.send') sends.push(req.args);
      },
    };
    let t = NOW_MS;
    // The realistic worst case: the schedule fires DAILY for 60 days while the
    // invoice stays overdue. Without the floor this is 60 customer emails; with
    // it, the default cadence (weekly, max 3) bounds it to 3 within the window.
    for (let i = 0; i < 60; i++) {
      const now = () => t;
      const h = makeHarness({ nudgeFloor: floor, now });
      h.deps.effects = sharedEffects;
      h.runs.nibbinState(NIB_ID).actionLevel = 'act';
      await executeRun(nibRef(), TRIGGER, program(), h.deps);
      t += 1 * DAY;
    }
    // default policy caps at 3 (≤ FLOOR_MAX_NUDGES); never spams the customer
    expect(sends.length).toBeLessThanOrEqual(3);
    expect(sends.length).toBe(3);
  });

  it('Stripe auto-dunning active → primitive defers, no send (no double-dunning)', async () => {
    const floor = new MemoryNudgeFloorStore();
    const { deps, sends } = makeHarness({
      nudgeFloor: floor,
      reader: overdueReader({
        collection_method: 'charge_automatically',
        auto_advance: true,
        next_payment_attempt: Math.floor((NOW_MS + 2 * DAY) / 1000),
      }),
    });
    const outcome = await executeRun(nibRef(), TRIGGER, program(), deps);
    // the primitive yields a compose note and returns → run completes, no send
    expect(outcome.kind).toBe('completed');
    expect(sends).toHaveLength(0);
    expect(await floor.history(NIB_ID, 'invoice', INVOICE, 0)).toHaveLength(0);
  });

  it('fail-open: a floor-store history throw still sends', async () => {
    const throwingFloor: RunnerDeps['nudgeFloor'] = {
      async history() {
        throw new Error('db down');
      },
      async record() {},
    };
    const { deps, sends } = makeHarness({ nudgeFloor: throwingFloor });
    const outcome = await executeRun(nibRef(), TRIGGER, program(), deps);
    expect(outcome.kind).toBe('executed');
    expect(sends).toHaveLength(1);
  });

  it('an owner stricter cadence (everyDays past the floor) blocks within its window', async () => {
    const floor = new MemoryNudgeFloorStore();
    // nudged 5 days ago — past the 3-day FLOOR, but inside a 14-day owner cadence
    floor.seed(NIB_ID, 'invoice', INVOICE, NOW_MS - 5 * DAY);
    const { deps, sends } = makeHarness({ nudgeFloor: floor });
    const outcome = await executeRun(nibRef(), TRIGGER, program({ cadenceEveryDays: 14 }), deps);
    expect(outcome.kind).toBe('completed');
    expect(outcome).toMatchObject({ nudgeSkipped: { reason: 'too_soon', floor: false } });
    expect(sends).toHaveLength(0);
  });

  it('no floor store wired → behaves as before (sends, unbounded) — backward compatible', async () => {
    const { deps, sends } = makeHarness({}); // nudgeFloor undefined
    const outcome = await executeRun(nibRef(), TRIGGER, program(), deps);
    expect(outcome.kind).toBe('executed');
    expect(sends).toHaveLength(1);
  });

  it('the floor only touches NUDGE sends — an ordinary thread reply (no invoiceId) is untouched', async () => {
    // A non-nudge email.send carrying a threadId but NO invoiceId must never be
    // gated by the floor (deriveNudgeFloor returns null). Drive a synthetic
    // program that drafts a plain reply, with a floor store that would BLOCK if
    // it were ever consulted (history throws → would fail-open, so instead use a
    // store whose history returns a saturated count to prove it is NOT consulted).
    const blockingFloor: RunnerDeps['nudgeFloor'] = {
      async history() {
        // If this were consulted for the reply it would not matter (no invoiceId),
        // but returning a saturated history makes the assertion unambiguous.
        return [NOW_MS, NOW_MS, NOW_MS, NOW_MS];
      },
      async record() {
        throw new Error('record should never be called for a non-nudge send');
      },
    };
    const { deps, sends } = makeHarness({ nudgeFloor: blockingFloor });
    const replyProgram: ProgramFn = async function* () {
      yield {
        kind: 'draft',
        capability: 'email.send',
        connectionId: GMAIL_CONN,
        patternKey: 'email.send:reply',
        title: 'Re: hello',
        draft: 'Thanks for your note!',
        effectArgs: { threadId: 'thread-123', to: 'someone@example.com' },
      };
    };
    const nib = nibRef();
    nib.spec.toolsAllowlist = ['email.send'];
    const outcome = await executeRun(nib, TRIGGER, replyProgram, deps);
    expect(outcome.kind).toBe('executed');
    expect(sends).toHaveLength(1);
  });

  it('the hard floor interval is exactly enforced at its boundary', async () => {
    const floor = new MemoryNudgeFloorStore();
    // exactly at the floor interval ago, with a cadence that equals the floor
    floor.seed(NIB_ID, 'invoice', INVOICE, NOW_MS - FLOOR_MIN_INTERVAL_MS);
    const { deps, sends } = makeHarness({ nudgeFloor: floor });
    // cadenceEveryDays=3 → clamps to the 3-day floor; exactly-elapsed passes
    const outcome = await executeRun(nibRef(), TRIGGER, program({ cadenceEveryDays: 3 }), deps);
    expect(outcome.kind).toBe('executed');
    expect(sends).toHaveLength(1);
  });
});
