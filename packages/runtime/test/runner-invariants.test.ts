/**
 * §6.2 runtime invariants, one by one, against the runner + memory stores
 * (the SQL RPCs re-enforce the money-critical subset; tests/rls/m4.test.ts
 * proves that side).
 */
import { describe, expect, it } from 'vitest';
import { quarantine } from '@nibbin/connectors';
import {
  executeRun,
  MemoryEventSink,
  MemoryGrantStore,
  MemoryIdempotencyStore,
  MemoryRoutineStore,
  MemoryRunStore,
  promotionCheck,
  REPETITION_KILL_AT,
  type AgentSpec,
  type Decision,
  type NibbinRef,
  type ProgramFn,
  type RunnerDeps,
} from '../src/index';

const ACCOUNT = 'acct-1';
const CONN = 'conn-1';
const TRIGGER = { kind: 'user' as const };

function spec(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    templateKey: 'echo',
    version: 1,
    displayName: 'Echo',
    toolsAllowlist: ['email.read', 'email.draft'],
    requiredConnectors: ['gmail'],
    triggers: [{ kind: 'user', debounceSecs: 0, cooldownSecs: 0 }],
    curriculum: {
      measures: 'test',
      promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95 },
      routineMinApprovals: 5,
    },
    creditProfile: { weightClass: 'standard', ceilings: { maxSteps: 5, maxTokens: 100, maxWallClockMs: 60_000 } },
    ...overrides,
  };
}

function nib(s: AgentSpec = spec()): NibbinRef {
  return { id: 'nib-1', accountId: ACCOUNT, name: 'Echo', stage: 'student', stageChangedAt: 0, status: 'active', spec: s };
}

function harness(opts: { credits?: number; now?: () => number; quarantined?: boolean } = {}) {
  const runs = new MemoryRunStore(opts.now ?? (() => Date.now()));
  runs.seedCredits(ACCOUNT, opts.credits ?? 100);
  const deps: RunnerDeps = {
    runs,
    routines: new MemoryRoutineStore(),
    grants: new MemoryGrantStore(),
    idempotency: new MemoryIdempotencyStore(),
    events: new MemoryEventSink(),
    reader: {
      async read(_c, _cap, path) {
        if (opts.quarantined === false) {
          return { wrapped: 'raw provider text with no markers', source: 'x', tag: 'deadbeefdeadbeefdeadbeef' };
        }
        return quarantine('{"ok":true}', `gmail:test:${path}`);
      },
    },
    effects: { async execute() {} },
    now: opts.now ?? (() => Date.now()),
  };
  return { deps, runs };
}

const read = (path: string) =>
  ({ kind: 'read', capability: 'email.read', connectionId: CONN, path }) as const;

describe('§6.2: pre-run budget check (weighted credits)', () => {
  it('charges the weight up front and completes', async () => {
    const h = harness({ credits: 10 });
    const program: ProgramFn = async function* () {
      yield read('/a');
    };
    const outcome = await executeRun(nib(), TRIGGER, program, h.deps);
    expect(outcome.kind).toBe('completed');
    expect(h.runs.balance(ACCOUNT)).toBe(9);
  });

  it('at cap: queues politely, runs nothing, charges nothing', async () => {
    const h = harness({ credits: 0 });
    let ran = false;
    const program: ProgramFn = async function* () {
      ran = true;
      yield read('/a');
    };
    const outcome = await executeRun(nib(), TRIGGER, program, h.deps);
    expect(outcome).toMatchObject({ kind: 'not_started', why: 'queued_cap' });
    expect(ran).toBe(false);
    expect(h.runs.balance(ACCOUNT)).toBe(0);
  });

  it('a queued run resumes once credits arrive — and charges then', async () => {
    const h = harness({ credits: 0 });
    const program: ProgramFn = async function* () {
      yield read('/a');
    };
    const outcome = await executeRun(nib(), TRIGGER, program, h.deps);
    const runId = (outcome as { runId: string }).runId;
    expect((await h.runs.resume(runId).catch(() => null))?.outcome ?? 'still_capped').toBe('still_capped');
    h.runs.seedCredits(ACCOUNT, 100);
    const resumed = await h.runs.resume(runId);
    expect(resumed.outcome).toBe('started');
    expect(h.runs.balance(ACCOUNT)).toBe(99);
  });

  it('frontier-heavy weight debits 3', async () => {
    const h = harness({ credits: 10 });
    const heavy = spec({ creditProfile: { weightClass: 'frontier', ceilings: { maxSteps: 5, maxTokens: 100, maxWallClockMs: 60_000 } } });
    const program: ProgramFn = async function* () {
      yield read('/a');
    };
    await executeRun(nib(heavy), TRIGGER, program, h.deps);
    expect(h.runs.balance(ACCOUNT)).toBe(7);
  });
});

describe('§6.2: per-run ceilings', () => {
  it('kills at max steps and refunds', async () => {
    const h = harness();
    const program: ProgramFn = async function* () {
      for (let i = 0; i < 20; i++) yield read(`/p/${i}`);
    };
    const outcome = await executeRun(nib(), TRIGGER, program, h.deps);
    expect(outcome).toMatchObject({ kind: 'killed', reason: 'max_steps' });
    expect(h.runs.balance(ACCOUNT)).toBe(100); // killed runs refund
  });

  it('kills at max tokens', async () => {
    const h = harness();
    const program: ProgramFn = async function* () {
      yield { kind: 'compose', tokens: 101, payload: {} };
    };
    const outcome = await executeRun(nib(), TRIGGER, program, h.deps);
    expect(outcome).toMatchObject({ kind: 'killed', reason: 'max_tokens' });
  });

  it('kills at the wall clock', async () => {
    let t = 0;
    const h = harness({ now: () => (t += 40_000) }); // each tick jumps 40s
    const program: ProgramFn = async function* () {
      yield read('/a');
      yield read('/b');
      yield read('/c');
    };
    const outcome = await executeRun(nib(), TRIGGER, program, h.deps);
    expect(outcome).toMatchObject({ kind: 'killed', reason: 'wall_clock' });
  });
});

describe('default ceilings clear a realistic mailbox sweep (cost-auditor P1-1)', () => {
  it('an 82-read program completes under the shop templates default maxSteps', async () => {
    // echo/sweep/scribe read up to 2 lists + 80 metadata reads per run; the
    // default ceiling must not self-kill them before they draft (the Day-One
    // first-draft DoD). Mirror the SHOP_TEMPLATES standard-weight ceiling.
    const h = harness({ credits: 100 });
    const mailboxSpec = spec({
      creditProfile: { weightClass: 'standard', ceilings: { maxSteps: 120, maxTokens: 12_000, maxWallClockMs: 60_000 } },
    });
    const program: ProgramFn = async function* () {
      for (let i = 0; i < 82; i++) yield read(`/gmail/v1/users/me/messages/m-${i}`);
      yield {
        kind: 'draft',
        capability: 'email.draft',
        connectionId: CONN,
        patternKey: 'p',
        title: 't',
        draft: 'd',
        effectArgs: {},
        presentation: true,
      };
    };
    const outcome = await executeRun(nib(mailboxSpec), TRIGGER, program, h.deps);
    expect(outcome.kind).toBe('awaiting_approval'); // drafted, not max_steps-killed
  });
});

describe('§6.2: same-tool-same-args repetition kill', () => {
  it(`kills on call #${REPETITION_KILL_AT} of an identical read`, async () => {
    const h = harness();
    const wide = spec({ creditProfile: { weightClass: 'standard', ceilings: { maxSteps: 50, maxTokens: 100, maxWallClockMs: 60_000 } } });
    const program: ProgramFn = async function* () {
      for (let i = 0; i < 10; i++) yield read('/same/path');
    };
    const outcome = await executeRun(nib(wide), TRIGGER, program, h.deps);
    expect(outcome).toMatchObject({ kind: 'killed', reason: 'repetition' });
  });

  it('distinct args do not trip the kill', async () => {
    const h = harness();
    const program: ProgramFn = async function* () {
      yield read('/a');
      yield read('/b');
      yield read('/c');
    };
    const outcome = await executeRun(nib(), TRIGGER, program, h.deps);
    expect(outcome.kind).toBe('completed');
  });
});

describe('§6.2/§6.5: allowlist + quarantine refusal', () => {
  it('kills a read outside the spec allowlist', async () => {
    const h = harness();
    const program: ProgramFn = async function* () {
      yield { kind: 'read', capability: 'payments.read', connectionId: CONN, path: '/v1/invoices' };
    };
    const outcome = await executeRun(nib(), TRIGGER, program, h.deps);
    expect(outcome).toMatchObject({ kind: 'killed', reason: 'allowlist' });
  });

  it('refuses tool output without quarantine markers', async () => {
    const h = harness({ quarantined: false });
    const program: ProgramFn = async function* () {
      yield read('/a');
    };
    const outcome = await executeRun(nib(), TRIGGER, program, h.deps);
    expect(outcome).toMatchObject({ kind: 'killed', reason: 'unquarantined' });
  });
});

describe('§6.2: trigger dedupe + cooldown + anomaly auto-pause', () => {
  it('dedupes the same dedupe key inside the debounce window', async () => {
    const h = harness();
    const s = spec({ triggers: [{ kind: 'event', source: 'connector:gmail:thread.overdue', debounceSecs: 600, cooldownSecs: 0 }] });
    const trigger = { kind: 'event' as const, key: 'connector:gmail:thread.overdue', dedupeKey: 'msg-1' };
    const program: ProgramFn = async function* () {
      yield read('/a');
    };
    expect((await executeRun(nib(s), trigger, program, h.deps)).kind).toBe('completed');
    expect(await executeRun(nib(s), trigger, program, h.deps)).toMatchObject({ kind: 'not_started', why: 'deduped' });
  });

  it('enforces the per-Nibbin cooldown', async () => {
    const h = harness();
    const s = spec({ triggers: [{ kind: 'user', debounceSecs: 0, cooldownSecs: 3600 }] });
    const program: ProgramFn = async function* () {
      yield read('/a');
    };
    expect((await executeRun(nib(s), TRIGGER, program, h.deps)).kind).toBe('completed');
    expect(await executeRun(nib(s), TRIGGER, program, h.deps)).toMatchObject({ kind: 'not_started', why: 'cooldown' });
  });

  it('auto-pauses at the anomaly threshold with the floor for new Nibbins', async () => {
    const h = harness({ credits: 1000 });
    const program: ProgramFn = async function* () {
      yield read('/a');
    };
    // floor is 10/day: ten runs pass, the eleventh pauses the Nibbin
    for (let i = 0; i < 10; i++) {
      expect((await executeRun(nib(), TRIGGER, program, h.deps)).kind).toBe('completed');
    }
    expect(await executeRun(nib(), TRIGGER, program, h.deps)).toMatchObject({ kind: 'not_started', why: 'anomaly_paused' });
    expect(h.runs.nibbinState('nib-1')).toMatchObject({ status: 'paused', pausedReason: 'anomaly' });
    // and a paused Nibbin is unavailable until un-paused
    expect(await executeRun(nib(), TRIGGER, program, h.deps)).toMatchObject({ kind: 'not_started', why: 'nibbin_unavailable' });
  });

  it('the queue→top-up path cannot bypass the anomaly ceiling (logic-skeptic P1-1)', async () => {
    const h = harness({ credits: 0 }); // start at cap
    const program: ProgramFn = async function* () {
      yield read('/a');
    };
    // queue 15 runs at cap (distinct dedupe keys); none have started, so none
    // count toward the anomaly window
    const queued: string[] = [];
    for (let i = 0; i < 15; i++) {
      const out = await executeRun(
        { ...nib(), id: 'nib-1' },
        { kind: 'user', dedupeKey: `q-${i}` },
        program,
        h.deps,
      );
      expect(out).toMatchObject({ kind: 'not_started', why: 'queued_cap' });
      queued.push((out as { runId: string }).runId);
    }
    // fund the account and resume: the floor (10/day) must still bite
    h.runs.seedCredits(ACCOUNT, 1000);
    let started = 0;
    let paused = false;
    for (const runId of queued) {
      const res = await h.runs.resume(runId);
      if (res.outcome === 'started') started += 1;
      if (res.outcome === 'anomaly_paused') paused = true;
    }
    expect(started).toBeLessThanOrEqual(10); // never more than the daily ceiling
    expect(paused).toBe(true); // the ceiling was enforced on resume, not bypassed
  });

  it('a run queued before an anomaly pause does not resume past the pause', async () => {
    const h = harness({ credits: 0 });
    const program: ProgramFn = async function* () {
      yield read('/a');
    };
    const out = await executeRun(nib(), { kind: 'user', dedupeKey: 'q' }, program, h.deps);
    const runId = (out as { runId: string }).runId;
    h.runs.nibbinState('nib-1').status = 'paused'; // paused while queued
    h.runs.seedCredits(ACCOUNT, 100);
    expect((await h.runs.resume(runId)).outcome).toBe('nibbin_unavailable');
  });
});

describe('§6.2: idempotency keys on side effects', () => {
  function granted() {
    const h = harness({ credits: 1000 });
    const routines = new MemoryRoutineStore();
    for (let i = 0; i < 5; i++) routines.approve('nib-1', 'p1');
    const grants = new MemoryGrantStore();
    grants.grant('nib-1', CONN, 'email.draft');
    h.deps.routines = routines;
    h.deps.grants = grants;
    return h;
  }
  const effect: ProgramFn = async function* () {
    yield {
      kind: 'draft',
      capability: 'email.draft',
      connectionId: CONN,
      patternKey: 'p1',
      title: 't',
      draft: 'd',
      effectArgs: { threadId: 't-1' },
    };
  };
  const seniorNib = (): NibbinRef => ({ ...nib(), stage: 'senior' });
  const sameEvent = { kind: 'event' as const, key: 'e', dedupeKey: 'evt-1' };

  it('a replayed trigger lands on the same key and does not double-execute', async () => {
    const h = granted();
    let executions = 0;
    h.deps.effects = { async execute() { executions += 1; } };

    const first = await executeRun(seniorNib(), sameEvent, effect, h.deps);
    expect(first.kind).toBe('executed');
    expect(executions).toBe(1);

    // same logical event again, outside the debounce window (debounce 0 here)
    const s = spec({ triggers: [{ kind: 'event', source: 'connector:gmail:thread.overdue', debounceSecs: 0, cooldownSecs: 0 }] });
    const again = await executeRun({ ...seniorNib(), spec: s }, sameEvent, effect, h.deps);
    expect(again.kind).toBe('executed'); // run completes…
    expect(executions).toBe(1); // …but the effect fired exactly once
  });

  it('an unconfirmed prior claim blocks retries (at-most-once)', async () => {
    const h = granted();
    h.deps.effects = {
      async execute() {
        throw new Error('provider timeout mid-send');
      },
    };
    const first = await executeRun(seniorNib(), sameEvent, effect, h.deps);
    expect(first.kind).toBe('failed');

    // retry: claim exists without confirmation → refuse to fire again
    let fired = 0;
    h.deps.effects = { async execute() { fired += 1; } };
    const s = spec({ triggers: [{ kind: 'event', source: 'connector:gmail:thread.overdue', debounceSecs: 0, cooldownSecs: 0 }] });
    const retry = await executeRun({ ...seniorNib(), spec: s }, sameEvent, effect, h.deps);
    expect(retry.kind).toBe('failed');
    expect(fired).toBe(0);
  });
});

describe('C8 (Connector Lever 1): calendar.event-create is a gated side effect', () => {
  const calSpec = (): AgentSpec =>
    spec({
      templateKey: 'cal',
      toolsAllowlist: ['calendar.read', 'calendar.event-create'],
      requiredConnectors: ['google-calendar'],
    });
  const calNib = (stage: NibbinRef['stage']): NibbinRef => ({
    ...nib(calSpec()),
    stage,
  });
  const createEvent: ProgramFn = async function* () {
    yield {
      kind: 'draft',
      capability: 'calendar.event-create',
      connectionId: CONN,
      patternKey: 'cal-1',
      title: 'Confirm shoot',
      draft: 'Proposed event',
      effectArgs: { calendarId: 'primary', event: { summary: 'Shoot' } },
    };
  };

  it('a below-Graduate Nibbin DRAFTS the calendar event — it never auto-executes (gateSideEffect)', async () => {
    const h = harness({ credits: 1000 });
    // Even with the write grant present, a Student is gated to draft.
    const grants = new MemoryGrantStore();
    grants.grant('nib-1', CONN, 'calendar.event-create');
    h.deps.grants = grants;
    let executed = 0;
    h.deps.effects = { async execute() { executed += 1; } };

    const outcome = await executeRun(calNib('student'), TRIGGER, createEvent, h.deps);
    expect(outcome.kind).toBe('awaiting_approval'); // drafted, awaiting human yes
    expect(executed).toBe(0); // the side effect did NOT fire
  });

  it('an Egg cannot produce a calendar event at all', async () => {
    const h = harness({ credits: 1000 });
    const outcome = await executeRun(calNib('egg'), TRIGGER, createEvent, h.deps);
    expect(outcome.kind).toBe('not_started'); // eggs observe; no output
  });

  it('a Graduate WITH the grant executes the calendar event (effects executor fires once)', async () => {
    const h = harness({ credits: 1000 });
    const grants = new MemoryGrantStore();
    grants.grant('nib-1', CONN, 'calendar.event-create');
    h.deps.grants = grants;
    let executed = 0;
    h.deps.effects = { async execute(req) { if (req.capability === 'calendar.event-create') executed += 1; } };

    const outcome = await executeRun(calNib('grad'), TRIGGER, createEvent, h.deps);
    expect(outcome.kind).toBe('executed');
    expect(executed).toBe(1);
  });

  it('a Graduate WITHOUT the grant falls back to draft (write-grant gate)', async () => {
    const h = harness({ credits: 1000 }); // empty MemoryGrantStore
    let executed = 0;
    h.deps.effects = { async execute() { executed += 1; } };
    const outcome = await executeRun(calNib('grad'), TRIGGER, createEvent, h.deps);
    expect(outcome.kind).toBe('awaiting_approval'); // no grant → draft, not execute
    expect(executed).toBe(0);
  });

  it('a Senior WITH the grant AND a proven routine EXECUTES the calendar event (earned-autonomy)', async () => {
    // A Senior on a proven routine (routineApprovals >= routineMinApprovals) is
    // equivalent to Graduate for auto-execution — this is the intended earned-autonomy
    // behavior. Lock it here so copy and code agree.
    const h = harness({ credits: 1000 });
    const grants = new MemoryGrantStore();
    grants.grant('nib-1', CONN, 'calendar.event-create');
    h.deps.grants = grants;
    // Seed routineMinApprovals approvals for the pattern key 'cal-1'
    const routines = new MemoryRoutineStore();
    const threshold = calSpec().curriculum.routineMinApprovals; // 5
    for (let i = 0; i < threshold; i++) routines.approve('nib-1', 'cal-1');
    h.deps.routines = routines;
    let executed = 0;
    h.deps.effects = { async execute(req) { if (req.capability === 'calendar.event-create') executed += 1; } };

    const outcome = await executeRun(calNib('senior'), TRIGGER, createEvent, h.deps);
    expect(outcome.kind).toBe('executed');
    expect(executed).toBe(1);
  });
});

describe('§4.7: promotion math (rolling window)', () => {
  const curriculum = {
    measures: 't',
    promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95 },
    routineMinApprovals: 5,
  };
  const decisions = (approved: number, other: number): Decision[] => [
    ...Array<Decision>(approved).fill('approved'),
    ...Array<Decision>(other).fill('edited'),
  ];

  it('24/25 approved-unedited (96%) is eligible', () => {
    expect(promotionCheck(decisions(24, 1), curriculum).eligible).toBe(true);
  });

  it('23/25 (92%) is not', () => {
    expect(promotionCheck(decisions(23, 2), curriculum).eligible).toBe(false);
  });

  it('fewer than 25 decided runs is never eligible (no time-served shortcut)', () => {
    expect(promotionCheck(decisions(24, 0), curriculum).eligible).toBe(false);
  });

  it('config can tighten but never loosen the floors', () => {
    const loose = { ...curriculum, promotion: { windowRuns: 5, minApprovedUneditedPct: 0.5 } };
    expect(promotionCheck(decisions(4, 1), loose).eligible).toBe(false); // floors hold at 25/0.95
    const tight = { ...curriculum, promotion: { windowRuns: 50, minApprovedUneditedPct: 0.98 } };
    expect(promotionCheck(decisions(49, 1), tight).eligible).toBe(true);
    expect(promotionCheck(decisions(47, 3), tight).eligible).toBe(false);
  });

  it('the window is rolling: old failures age out', () => {
    // newest-first: 25 clean approvals, then ancient rejections beyond the window
    const history: Decision[] = [...Array<Decision>(25).fill('approved'), ...Array<Decision>(10).fill('rejected')];
    expect(promotionCheck(history, curriculum).eligible).toBe(true);
  });
});

describe('#43: stage/status re-checked mid-run — demoted Nibbin drafts not executes', () => {
  function grantedHarness() {
    const runs = new MemoryRunStore(() => Date.now());
    runs.seedCredits(ACCOUNT, 1000);
    const routines = new MemoryRoutineStore();
    // 5 approvals recorded AFTER stageChangedAt=0, so they count for senior autonomy
    for (let i = 0; i < 5; i++) routines.approve('nib-1', 'p1');
    const grants = new MemoryGrantStore();
    grants.grant('nib-1', CONN, 'email.draft');
    const deps: RunnerDeps = {
      runs,
      routines,
      grants,
      idempotency: new MemoryIdempotencyStore(),
      events: new MemoryEventSink(),
      reader: { async read(_c, _cap, path) { return quarantine('{}', `test:${path}`); } },
      effects: { async execute() {} },
      now: () => Date.now(),
    };
    return { deps, runs };
  }

  const draftStep: ProgramFn = async function* () {
    yield {
      kind: 'draft',
      capability: 'email.draft',
      connectionId: CONN,
      patternKey: 'p1',
      title: 't',
      draft: 'd',
      effectArgs: { threadId: 't-1' },
    };
  };

  it('a grad run executes normally when no demotion occurs', async () => {
    const { deps } = grantedHarness();
    const gradNib: NibbinRef = { id: 'nib-1', accountId: ACCOUNT, name: 'Echo', stage: 'grad', stageChangedAt: 0, status: 'active', spec: spec() };
    const outcome = await executeRun(gradNib, TRIGGER, draftStep, deps);
    expect(outcome.kind).toBe('executed');
  });

  it('a grad run demoted mid-run (store stage flipped to student) drafts instead of executing', async () => {
    const { deps, runs } = grantedHarness();
    const gradNib: NibbinRef = { id: 'nib-1', accountId: ACCOUNT, name: 'Echo', stage: 'grad', stageChangedAt: 0, status: 'active', spec: spec() };
    // Simulate nibbin_demote firing between begin() and the execute decision:
    // flip the in-memory stage to 'student' so getNibbin returns the stale-demoted state.
    const program: ProgramFn = async function* () {
      // Demote inside the program, simulating a concurrent demotion between steps
      runs.nibbinState('nib-1').stage = 'student';
      yield {
        kind: 'draft',
        capability: 'email.draft',
        connectionId: CONN,
        patternKey: 'p1',
        title: 't',
        draft: 'd',
        effectArgs: { threadId: 't-1' },
      };
    };
    const outcome = await executeRun(gradNib, TRIGGER, program, deps);
    // Must draft-not-execute: the freshly-read stage is 'student'
    expect(outcome.kind).toBe('awaiting_approval');
  });

  it('a nibbin paused mid-run (store status flipped to paused) also drafts instead of executing', async () => {
    const { deps, runs } = grantedHarness();
    const gradNib: NibbinRef = { id: 'nib-1', accountId: ACCOUNT, name: 'Echo', stage: 'grad', stageChangedAt: 0, status: 'active', spec: spec() };
    const program: ProgramFn = async function* () {
      // Simulate a concurrent pause between admission and execute
      runs.nibbinState('nib-1').status = 'paused';
      yield {
        kind: 'draft',
        capability: 'email.draft',
        connectionId: CONN,
        patternKey: 'p1',
        title: 't',
        draft: 'd',
        effectArgs: { threadId: 't-1' },
      };
    };
    const outcome = await executeRun(gradNib, TRIGGER, program, deps);
    expect(outcome.kind).toBe('awaiting_approval');
  });
});

describe('#44: routine-pattern trust resets on demotion (stage-scoped approvals)', () => {
  const DEMOTION_AT = 1_000_000; // ms timestamp simulating when demotion happened

  function stageHarness(now = () => Date.now()) {
    const runs = new MemoryRunStore(now);
    runs.seedCredits(ACCOUNT, 1000);
    const routines = new MemoryRoutineStore(now);
    const grants = new MemoryGrantStore();
    grants.grant('nib-1', CONN, 'email.draft');
    const deps: RunnerDeps = {
      runs, routines, grants,
      idempotency: new MemoryIdempotencyStore(),
      events: new MemoryEventSink(),
      reader: { async read(_c, _cap, path) { return quarantine('{}', `test:${path}`); } },
      effects: { async execute() {} },
      now,
    };
    return { deps, runs, routines };
  }

  it('approvals recorded BEFORE demotion do not count toward re-promotion autonomy', async () => {
    let t = 0;
    const { routines } = stageHarness(() => t);

    // 5 approvals BEFORE demotion
    t = DEMOTION_AT - 5000;
    for (let i = 0; i < 5; i++) routines.approve('nib-1', 'p1');

    // After demotion, stageChangedAt resets to DEMOTION_AT
    const count = await routines.approvedCount('nib-1', 'p1', DEMOTION_AT);
    // Pre-demotion approvals are excluded from current stage tenure
    expect(count).toBe(0);
  });

  it('approvals recorded AFTER demotion count toward re-promotion autonomy', async () => {
    let t = 0;
    const { routines } = stageHarness(() => t);

    // 3 approvals BEFORE demotion — should not count
    t = DEMOTION_AT - 5000;
    for (let i = 0; i < 3; i++) routines.approve('nib-1', 'p1');

    // 4 approvals AFTER demotion — should count
    t = DEMOTION_AT + 1000;
    for (let i = 0; i < 4; i++) routines.approve('nib-1', 'p1');

    const count = await routines.approvedCount('nib-1', 'p1', DEMOTION_AT);
    expect(count).toBe(4);
  });

  it('a senior whose pattern was approved pre-demotion does not regain autonomy after re-promotion', async () => {
    let t = 0;
    const { deps, runs, routines } = stageHarness(() => t);

    // Record 5 approvals for pattern p1 BEFORE demotion timestamp
    t = DEMOTION_AT - 1000;
    for (let i = 0; i < 5; i++) routines.approve('nib-1', 'p1');

    // Re-promoted senior: stageChangedAt = DEMOTION_AT (simulates a re-promotion after demotion)
    const seniorNibRePromoted: NibbinRef = {
      id: 'nib-1',
      accountId: ACCOUNT,
      name: 'Echo',
      stage: 'senior',
      stageChangedAt: DEMOTION_AT, // stage reset at demotion time
      status: 'active',
      spec: spec(),
    };

    t = DEMOTION_AT + 2000; // now is after re-promotion
    const outcome = await executeRun(seniorNibRePromoted, TRIGGER, async function* () {
      yield {
        kind: 'draft',
        capability: 'email.draft',
        connectionId: CONN,
        patternKey: 'p1',
        title: 't',
        draft: 'd',
        effectArgs: { threadId: 't-1' },
      };
    }, deps);
    // Should draft, not execute: pre-demotion approvals excluded, count=0 < routineMinApprovals=5
    expect(outcome.kind).toBe('awaiting_approval');
    void runs; // suppress unused warning
  });
});
