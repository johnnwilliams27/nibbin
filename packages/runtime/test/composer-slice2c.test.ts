/**
 * Composer Slice 2c — the digest/summarize shape (design §2/§3):
 *  - topSenders BEHAVIORAL: digest.inbox-cleanup with a non-default topSenders
 *    changes the digest list length (the only behavior 2c adds beyond sweep).
 *  - VALIDATOR (fail-closed): a digest.morning composed spec validates only when
 *    ALL THREE connectors (gcal+stripe+gmail) are granted; it is rejected when
 *    EACH one is individually missing. digest.inbox-cleanup validates with gmail,
 *    is rejected without.
 *  - e2e: a digest steps-spec runs through interpretSpec → executeRun with
 *    path-aware reader stubs → awaiting_approval with a PRESENTATION draft and
 *    the expected effectArgs. The presentation draft NEVER executes
 *    (h.executed length 0), at any stage.
 */
import { describe, expect, it } from 'vitest';
import { quarantine } from '@nibbin/connectors';
import {
  digestInboxCleanup,
  executeRun,
  interpretSpec,
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

const ACCOUNT = 'acct-2c';
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

function nib(s: AgentSpec): NibbinRef {
  return { id: 'nib-2c', accountId: ACCOUNT, name: 'Composed', stage: 'student', status: 'active', spec: s };
}

function gmailMeta(id: string, headers: Record<string, string>, internalDate: number): string {
  return JSON.stringify({
    id,
    threadId: id,
    internalDate: String(internalDate),
    payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) },
  });
}

/* ── validator: per-primitive connector gating (incl. the 3-connector case) ── */

describe('validateComposedSpec — digest family connector gating', () => {
  it('accepts digest.inbox-cleanup when gmail is granted; rejects when not', () => {
    const s = spec({
      displayName: 'Morning inbox sweep',
      toolsAllowlist: ['email.read'],
      requiredConnectors: ['gmail'],
      steps: [{ capability: 'digest.inbox-cleanup', inputs: { topSenders: 5 } }],
    });
    expect(validateComposedSpec(s, ['gmail'])).toEqual([]);
    expect(validateComposedSpec(s, []).some((p) => /not connected/.test(p))).toBe(true);
  });

  it('accepts digest.morning when ALL THREE (gcal+stripe+gmail) are granted', () => {
    const s = spec({
      displayName: 'Morning brief',
      toolsAllowlist: ['calendar.read', 'payments.read', 'email.read'],
      requiredConnectors: ['google-calendar', 'stripe', 'gmail'],
      steps: [{ capability: 'digest.morning', inputs: {} }],
    });
    expect(validateComposedSpec(s, ['google-calendar', 'stripe', 'gmail'])).toEqual([]);
  });

  it('rejects digest.morning when gmail is missing', () => {
    const s = spec({
      displayName: 'Morning brief',
      toolsAllowlist: ['calendar.read', 'payments.read', 'email.read'],
      requiredConnectors: ['google-calendar', 'stripe', 'gmail'],
      steps: [{ capability: 'digest.morning', inputs: {} }],
    });
    const problems = validateComposedSpec(s, ['google-calendar', 'stripe']);
    expect(problems.some((p) => /gmail.*not connected/.test(p))).toBe(true);
  });

  it('rejects digest.morning when stripe is missing', () => {
    const s = spec({
      displayName: 'Morning brief',
      toolsAllowlist: ['calendar.read', 'payments.read', 'email.read'],
      requiredConnectors: ['google-calendar', 'stripe', 'gmail'],
      steps: [{ capability: 'digest.morning', inputs: {} }],
    });
    const problems = validateComposedSpec(s, ['google-calendar', 'gmail']);
    expect(problems.some((p) => /stripe.*not connected/.test(p))).toBe(true);
  });

  it('rejects digest.morning when google-calendar is missing', () => {
    const s = spec({
      displayName: 'Morning brief',
      toolsAllowlist: ['calendar.read', 'payments.read', 'email.read'],
      requiredConnectors: ['google-calendar', 'stripe', 'gmail'],
      steps: [{ capability: 'digest.morning', inputs: {} }],
    });
    const problems = validateComposedSpec(s, ['stripe', 'gmail']);
    expect(problems.some((p) => /google-calendar.*not connected/.test(p))).toBe(true);
  });

  it('rejects an out-of-bounds topSenders (above max 20)', () => {
    const s = spec({
      toolsAllowlist: ['email.read'],
      requiredConnectors: ['gmail'],
      steps: [{ capability: 'digest.inbox-cleanup', inputs: { topSenders: 999 } }],
    });
    expect(validateComposedSpec(s, ['gmail']).some((p) => /above max/.test(p))).toBe(true);
  });

  it('rejects an unknown input on digest.morning (empty schema accepts no keys)', () => {
    const s = spec({
      toolsAllowlist: ['calendar.read', 'payments.read', 'email.read'],
      requiredConnectors: ['google-calendar', 'stripe', 'gmail'],
      steps: [{ capability: 'digest.morning', inputs: { evil: 1 } as Record<string, unknown> }],
    });
    expect(validateComposedSpec(s, ['google-calendar', 'stripe', 'gmail']).some((p) => /unknown input/.test(p))).toBe(true);
  });
});

/* ── topSenders behavioral (the only behavior 2c adds beyond the template) ─── */

/** Mailbox of `distinct` newsletter senders (each one List-Unsubscribe message),
 *  no sent. Drives the top-N path with a controllable number of senders. */
function noisyMailboxReader(distinct: number): (c: string, path: string) => string {
  return (_c, path) => {
    if (path.includes('/messages?')) {
      const isSent = path.includes('in%3Asent') || path.includes('in:sent');
      if (isSent) return '{"messages":[]}';
      const ids = Array.from({ length: distinct }, (_v, i) => `{"id":"s${i}"}`).join(',');
      return `{"messages":[${ids}]}`;
    }
    // metadata fetch — derive the sender index from the id in the path.
    const m = path.match(/s(\d+)/);
    const i = m ? Number(m[1]) : 0;
    return gmailMeta(
      `s${i}`,
      { From: `Sender ${i} <news${i}@example.com>`, Subject: 'Weekly', 'List-Unsubscribe': '<mailto:u@x>' },
      NOW - 1 * DAY,
    );
  };
}

describe('digest.inbox-cleanup topSenders parameterization', () => {
  it('topSenders=2 on a 4-distinct-sender inbox lists exactly 2 (effectArgs.senders length 2)', async () => {
    const h = harness(noisyMailboxReader(4));
    const s = spec({
      toolsAllowlist: ['email.read'],
      requiredConnectors: ['gmail'],
      steps: [{ capability: 'digest.inbox-cleanup', inputs: { topSenders: 2 } }],
    });
    const outcome = await executeRun(nib(s), TRIGGER, interpretSpec(s, { gmail: GMAIL }, NOW), h.deps);
    expect(outcome.kind).toBe('awaiting_approval');
    if (outcome.kind !== 'awaiting_approval') throw new Error('expected awaiting_approval');
    expect(outcome.draft.presentation).toBe(true);
    const senders = outcome.draft.effectArgs.senders as string[];
    expect(senders).toHaveLength(2);
    // The digest body lists exactly two "• … — N messages" lines.
    expect(outcome.draft.draft.match(/^• /gm) ?? []).toHaveLength(2);
  });

  it('topSenders=5 (default) on the same inbox lists all 4 distinct senders', async () => {
    const h = harness(noisyMailboxReader(4));
    const s = spec({
      toolsAllowlist: ['email.read'],
      requiredConnectors: ['gmail'],
      steps: [{ capability: 'digest.inbox-cleanup', inputs: {} }],
    });
    const outcome = await executeRun(nib(s), TRIGGER, interpretSpec(s, { gmail: GMAIL }, NOW), h.deps);
    if (outcome.kind !== 'awaiting_approval') throw new Error('expected awaiting_approval');
    expect((outcome.draft.effectArgs.senders as string[])).toHaveLength(4);
  });

  it('topSenders param is honored directly by the primitive factory (deterministic)', async () => {
    const steps = await drive(
      digestInboxCleanup({ topSenders: 1 }, { gmail: GMAIL }, NOW),
      (step) => (step.kind === 'read' ? noisyMailboxReader(3)('', step.path) : undefined),
    );
    const draft = steps.find((s) => s.kind === 'draft');
    if (!draft || draft.kind !== 'draft') throw new Error('expected draft');
    expect((draft.effectArgs.senders as string[])).toHaveLength(1);
  });
});

/* ── e2e: dispatch each digest through the real runner (presentation only) ──── */

interface Harness {
  deps: RunnerDeps;
  reads: Array<{ connectionId: string; path: string }>;
  executed: Array<{ capability: string }>;
  /** Exposed so a test can seed routine approvals / write-grants to isolate the
   *  presentation gate from the stage/novelty/grant gates (FIX 1). */
  routines: MemoryRoutineStore;
  grants: MemoryGrantStore;
}

function harness(reader: (connectionId: string, path: string) => string): Harness {
  const runs = new MemoryRunStore(() => Date.now());
  runs.seedCredits(ACCOUNT, 100);
  const reads: Array<{ connectionId: string; path: string }> = [];
  const executed: Array<{ capability: string }> = [];
  const routines = new MemoryRoutineStore();
  const grants = new MemoryGrantStore();
  const deps: RunnerDeps = {
    runs,
    routines,
    grants,
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
  return { deps, reads, executed, routines, grants };
}

function morningReader(): (c: string, path: string) => string {
  return (_c, path) => {
    if (path.includes('/calendar/')) {
      return JSON.stringify({
        items: [{ summary: 'Discovery call', start: { dateTime: new Date(NOW + DAY).toISOString() } }],
      });
    }
    if (path.includes('/v1/invoices')) {
      return JSON.stringify({
        data: [{ id: 'in_1', status: 'open', due_date: Math.floor((NOW - 5 * DAY) / 1000), amount_due: 12_345 }],
      });
    }
    return '{"messages":[{"id":"m1"},{"id":"m2"}]}';
  };
}

describe('interpreter dispatches the digest primitives through the runner (presentation only)', () => {
  it('digest.inbox-cleanup → awaiting_approval PRESENTATION draft; never executes', async () => {
    const h = harness(noisyMailboxReader(2));
    const s = spec({
      toolsAllowlist: ['email.read'],
      requiredConnectors: ['gmail'],
      steps: [{ capability: 'digest.inbox-cleanup', inputs: {} }],
    });
    const outcome = await executeRun(nib(s), TRIGGER, interpretSpec(s, { gmail: GMAIL }, NOW), h.deps);
    expect(outcome.kind).toBe('awaiting_approval');
    if (outcome.kind !== 'awaiting_approval') throw new Error('expected awaiting_approval');
    expect(h.executed).toHaveLength(0);
    expect(outcome.draft.capability).toBe('email.read');
    expect(outcome.draft.connectionId).toBe(GMAIL);
    expect(outcome.draft.patternKey).toBe('sweep:keep-or-clear');
    expect(outcome.draft.presentation).toBe(true);
    expect((outcome.draft.effectArgs.senders as string[]).length).toBeGreaterThanOrEqual(1);
  });

  it('digest.morning (3 sources) → awaiting_approval PRESENTATION digest; never executes', async () => {
    const h = harness(morningReader());
    const s = spec({
      toolsAllowlist: ['calendar.read', 'payments.read', 'email.read'],
      requiredConnectors: ['google-calendar', 'stripe', 'gmail'],
      steps: [{ capability: 'digest.morning', inputs: {} }],
    });
    const outcome = await executeRun(
      nib(s),
      TRIGGER,
      interpretSpec(s, { 'google-calendar': GCAL, stripe: STRIPE, gmail: GMAIL }, NOW),
      h.deps,
    );
    expect(outcome.kind).toBe('awaiting_approval');
    if (outcome.kind !== 'awaiting_approval') throw new Error('expected awaiting_approval');
    expect(h.executed).toHaveLength(0);
    // Three reads rode three distinct connections.
    expect(h.reads).toHaveLength(3);
    expect(h.reads.find((r) => r.path.includes('/calendar/'))?.connectionId).toBe(GCAL);
    expect(h.reads.find((r) => r.path.includes('/v1/invoices'))?.connectionId).toBe(STRIPE);
    expect(h.reads.find((r) => r.path.includes('/gmail/'))?.connectionId).toBe(GMAIL);
    expect(outcome.draft.capability).toBe('email.read');
    expect(outcome.draft.connectionId).toBe(GMAIL);
    expect(outcome.draft.patternKey).toBe('brief:morning-digest');
    expect(outcome.draft.presentation).toBe(true);
    expect(outcome.draft.effectArgs).toEqual({ events: 1, freshMail: 2, overdue: 1 });
  });

  it('digest.inbox-cleanup never executes even at a SENIOR stage — presentation is the BINDING constraint', async () => {
    const h = harness(noisyMailboxReader(2));
    const s = spec({
      toolsAllowlist: ['email.read'],
      requiredConnectors: ['gmail'],
      steps: [{ capability: 'digest.inbox-cleanup', inputs: {} }],
    });
    const seniorNib: NibbinRef = { ...nib(s), stage: 'senior' };

    // Remove every NON-presentation reason to draft, so the ONLY thing keeping
    // this from executing is `presentation: true`:
    //  - seed routineApprovals ≥ curriculum.routineMinApprovals (5) for this
    //    digest's exact patternKey, so gateSideEffect('senior', 5, …) → execute
    //    (school.ts:38) rather than draft/reason:'novelty'; and
    //  - grant email.read on the gmail connection so the C8 grant gate
    //    (runner.ts:258) does not itself force a fallback to draft.
    // With both removed, a NON-presentation draft step with this exact seeding
    // WOULD reach { action: 'execute' } and run; this stays awaiting_approval
    // ONLY because the digest yields presentation:true. (Verified to bite:
    // flip the impl's presentation→false and this test fails — h.executed → 1.)
    for (let i = 0; i < CURRICULUM.routineMinApprovals; i++) {
      h.routines.approve(seniorNib.id, 'sweep:keep-or-clear');
    }
    h.grants.grant(seniorNib.id, GMAIL, 'email.read');

    const outcome = await executeRun(seniorNib, TRIGGER, interpretSpec(s, { gmail: GMAIL }, NOW), h.deps);
    expect(outcome.kind).toBe('awaiting_approval');
    expect(h.executed).toHaveLength(0);
  });
});

/* ── parity helper: drive a ProgramFn to exhaustion ───────────────────────── */

async function drive(
  program: ProgramFn,
  responder: (step: ProgramStep) => string | undefined,
): Promise<ProgramStep[]> {
  const steps: ProgramStep[] = [];
  const gen = program({ nibbin: nib(spec({})), trigger: TRIGGER });
  let fed: ReturnType<typeof quarantine> | undefined;
  for (;;) {
    const r = await gen.next(fed as ReturnType<typeof quarantine>);
    if (r.done) break;
    steps.push(r.value);
    const body = responder(r.value);
    fed = body !== undefined ? quarantine(body, 'prov:test') : undefined;
  }
  return steps;
}
