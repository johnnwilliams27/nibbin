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
  MemoryResourceClaimStore,
  MemoryRoutineStore,
  MemoryRunStore,
  nudgeOverdueEmail,
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
    toolsAllowlist: ['email.read', 'email.send'],
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
        capability: 'email.send',
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
    // Action level 'send' is required for the execute path under the new model.
    // Grants and routines are no longer part of the gate decision but remain in
    // deps for other callers; we keep them here for structural completeness.
    h.runs.nibbinState('nib-1').actionLevel = 'send';
    const routines = new MemoryRoutineStore();
    for (let i = 0; i < 5; i++) routines.approve('nib-1', 'p1');
    const grants = new MemoryGrantStore();
    grants.grant('nib-1', CONN, 'email.send');
    h.deps.routines = routines;
    h.deps.grants = grants;
    return h;
  }
  const effect: ProgramFn = async function* () {
    yield {
      kind: 'draft',
      capability: 'email.send',
      connectionId: CONN,
      patternKey: 'p1',
      title: 't',
      draft: 'd',
      effectArgs: { threadId: 't-1' },
    };
  };
  // Stage no longer gates execution; any stage with actionLevel='send' executes.
  // Using 'student' here to prove stage is irrelevant to the execute path.
  const seniorNib = (): NibbinRef => ({ ...nib(), stage: 'student' });
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

describe('C8 (Connector Lever 1): calendar.event-create gates on action level (not stage)', () => {
  // CONVERTED from stage-gating to action-level gating (Task 2).
  // OLD model: stage determined draft-vs-execute (graduate/senior+routine → execute).
  // NEW model: actionLevel is the sole gate (send → execute; draft → draft; observe → no output).
  // Stage is irrelevant to the draft-vs-execute decision.
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

  it('actionLevel=draft → drafts the calendar event at any stage (including Graduate)', async () => {
    // CONVERTED: was "below-Graduate Nibbin DRAFTS (gateSideEffect)".
    // Now: draft level causes draft at ALL grades — Graduate included.
    const h = harness({ credits: 1000 });
    // default actionLevel is 'draft' — explicit for clarity
    h.runs.nibbinState('nib-1').actionLevel = 'draft';
    let executed = 0;
    h.deps.effects = { async execute() { executed += 1; } };

    const outcome = await executeRun(calNib('grad'), TRIGGER, createEvent, h.deps);
    expect(outcome.kind).toBe('awaiting_approval'); // draft level → draft regardless of grade
    expect(executed).toBe(0); // side effect did NOT fire
  });

  it('an Egg + send EXECUTES the calendar event (egg admission fence REMOVED — action_level is the sole gate)', async () => {
    // FIX 4: the egg run-admission fence is removed. An Egg now admits and is
    // governed solely by action_level. egg + send → acts (behind the unchanged
    // idempotency / resource-claim walls).
    const h = harness({ credits: 1000 });
    h.runs.nibbinState('nib-1').actionLevel = 'send';
    let executed = 0;
    h.deps.effects = { async execute(req) { if (req.capability === 'calendar.event-create') executed += 1; } };
    const outcome = await executeRun(calNib('egg'), TRIGGER, createEvent, h.deps);
    expect(outcome.kind).toBe('executed');
    expect(executed).toBe(1);
  });

  it('an Egg + draft DRAFTS the calendar event (egg admits, action_level=draft → draft)', async () => {
    const h = harness({ credits: 1000 });
    h.runs.nibbinState('nib-1').actionLevel = 'draft';
    let executed = 0;
    h.deps.effects = { async execute() { executed += 1; } };
    const outcome = await executeRun(calNib('egg'), TRIGGER, createEvent, h.deps);
    expect(outcome.kind).toBe('awaiting_approval');
    expect(executed).toBe(0);
  });

  it('an Egg + observe produces NO output (kill:observe) — egg admits, action_level=observe → deny', async () => {
    const h = harness({ credits: 1000 });
    h.runs.nibbinState('nib-1').actionLevel = 'observe';
    let executed = 0;
    h.deps.effects = { async execute() { executed += 1; } };
    const outcome = await executeRun(calNib('egg'), TRIGGER, createEvent, h.deps);
    expect(outcome.kind).toBe('killed');
    expect((outcome as { reason: string }).reason).toBe('observe');
    expect(executed).toBe(0);
  });

  it('actionLevel=send → executes the calendar event at any stage (Student executes)', async () => {
    // CONVERTED: was "Graduate WITH grant executes".
    // NEW: send level executes at ANY grade — even Student. No grant check.
    const h = harness({ credits: 1000 });
    h.runs.nibbinState('nib-1').actionLevel = 'send';
    let executed = 0;
    h.deps.effects = { async execute(req) { if (req.capability === 'calendar.event-create') executed += 1; } };

    // Using 'student' to prove stage no longer gates execution
    const outcome = await executeRun(calNib('student'), TRIGGER, createEvent, h.deps);
    expect(outcome.kind).toBe('executed');
    expect(executed).toBe(1);
  });

  it('actionLevel=send with no grant still executes (hasGrant removed from gate)', async () => {
    // CONVERTED: was "Graduate WITHOUT grant falls back to draft".
    // NEW: hasGrant is NOT in the gate path. send level executes regardless.
    // Empty MemoryGrantStore (no grants), actionLevel=send → still executes.
    const h = harness({ credits: 1000 }); // empty MemoryGrantStore
    h.runs.nibbinState('nib-1').actionLevel = 'send';
    let executed = 0;
    h.deps.effects = { async execute() { executed += 1; } };
    const outcome = await executeRun(calNib('grad'), TRIGGER, createEvent, h.deps);
    expect(outcome.kind).toBe('executed'); // send level → execute, no grant needed
    expect(executed).toBe(1);
  });

  it('actionLevel=observe → produces no output (kill:observe) at any stage', async () => {
    // CONVERTED: was "Senior WITH grant AND proven routine EXECUTES (earned-autonomy)".
    // NEW: observe level kills with reason 'observe' — no grade can override.
    const h = harness({ credits: 1000 });
    h.runs.nibbinState('nib-1').actionLevel = 'observe';
    let executed = 0;
    h.deps.effects = { async execute() { executed += 1; } };

    // Using 'senior' (the highest non-grad grade) to prove grade can't override observe
    const outcome = await executeRun(calNib('senior'), TRIGGER, createEvent, h.deps);
    expect(outcome.kind).toBe('killed');
    expect((outcome as { reason: string }).reason).toBe('observe');
    expect(executed).toBe(0);
  });
});

describe('§ action-levels: action level is the sole execution gate', () => {
  // These are the PRIMARY new tests for Task 2. They prove:
  //  • observe → no output (kill:observe) at any grade
  //  • draft   → always drafts at any grade
  //  • send    → always executes at any grade (incl. Egg pre-run guard bypassed via dispatchStep)
  //
  // FIX 4: the egg run-admission fence is REMOVED — an Egg admits and is gated
  // solely by action_level in dispatchStep. So Egg + Send executes via executeRun
  // directly (no need to drive dispatchStep separately).

  const sendStep: ProgramFn = async function* () {
    yield {
      kind: 'draft',
      capability: 'email.send',
      connectionId: CONN,
      patternKey: 'p-al',
      title: 't',
      draft: 'd',
      effectArgs: { threadId: 't-al-1' },
    };
  };

  function actionHarness(actionLevel: 'observe' | 'draft' | 'send', stage: NibbinRef['stage'] = 'student') {
    const h = harness({ credits: 1000 });
    h.runs.nibbinState('nib-1').actionLevel = actionLevel;
    const nibRef: NibbinRef = { ...nib(), stage };
    return { h, nibRef };
  }

  it('action-level Send executes regardless of stage — INCLUDING Egg (fence removed)', async () => {
    // FIX 4: with the egg admission fence removed, an Egg + Send executes through
    // executeRun directly — action_level is the sole gate, stage is advisory.
    const { h, nibRef } = actionHarness('send', 'egg');
    let executed = 0;
    h.deps.effects = { async execute() { executed += 1; } };
    const out = await executeRun(nibRef, TRIGGER, sendStep, h.deps);
    expect(out.kind).toBe('executed');
    expect(executed).toBe(1);
  });

  it('Graduate + Draft drafts (action level overrides grade)', async () => {
    // A Graduate with actionLevel=draft drafts — grade cannot override the owner's choice.
    const { h, nibRef } = actionHarness('draft', 'grad');
    const out = await executeRun(nibRef, TRIGGER, sendStep, h.deps);
    expect(out.kind).toBe('awaiting_approval');
  });

  it('Observe produces no output at any stage (Senior + observe → kill:observe)', async () => {
    // observe level produces no draft and no execution — a kill with reason 'observe'.
    const { h, nibRef } = actionHarness('observe', 'senior');
    const out = await executeRun(nibRef, TRIGGER, sendStep, h.deps);
    expect(out.kind).toBe('killed');
    expect((out as { reason: string }).reason).toBe('observe');
  });

  it('Student + send executes (grade is no longer a barrier)', async () => {
    const { h, nibRef } = actionHarness('send', 'student');
    const out = await executeRun(nibRef, TRIGGER, sendStep, h.deps);
    expect(out.kind).toBe('executed');
  });

  it('presentation steps are always drafts even at send level', async () => {
    // step.presentation=true → always draft regardless of actionLevel
    const { h, nibRef } = actionHarness('send', 'grad');
    const out = await executeRun(nibRef, TRIGGER, async function* () {
      yield {
        kind: 'draft',
        capability: 'email.send',
        connectionId: CONN,
        patternKey: 'p-pres',
        title: 't',
        draft: 'd',
        effectArgs: {},
        presentation: true,
      };
    }, h.deps);
    expect(out.kind).toBe('awaiting_approval');
  });

  it('P0-2: presentation step at OBSERVE level is suppressed (kill:observe, ZERO draft rows)', async () => {
    // The observe deny is evaluated BEFORE the presentation/draft arm, so a
    // presentation/digest step at observe level produces NO output — not a draft.
    const { h, nibRef } = actionHarness('observe', 'grad');
    let executed = 0;
    h.deps.effects = { async execute() { executed += 1; } };
    const out = await executeRun(nibRef, TRIGGER, async function* () {
      yield {
        kind: 'draft',
        capability: 'email.send',
        connectionId: CONN,
        patternKey: 'p-pres-obs',
        title: 'Digest',
        draft: 'digest body',
        effectArgs: {},
        presentation: true,
      };
    }, h.deps);
    expect(out.kind).toBe('killed');
    expect((out as { reason: string }).reason).toBe('observe');
    expect(executed).toBe(0);
    // ZERO draft rows recorded
    const runId = (out as { runId: string }).runId;
    const draftRows = h.runs.getSteps(runId).filter((s) => s.kind === 'draft');
    expect(draftRows).toHaveLength(0);
  });

  it('P1-2: an unknown / NULL action_level fails SAFE to draft (never execute)', async () => {
    // The execute arm requires level === 'send' explicitly; any other value
    // (NULL, out-of-enum, future value) must default to draft — never auto-send.
    const { h, nibRef } = actionHarness('send', 'student');
    // Force an out-of-enum level past the typed setter.
    (h.runs.nibbinState('nib-1') as { actionLevel: unknown }).actionLevel = 'bogus-level';
    let sent = 0;
    // Count only real SENDS (executor calls without the nativeDraft mirror flag).
    h.deps.effects = { async execute(req) { if (req.args.nativeDraft !== true) sent += 1; } };
    const out = await executeRun(nibRef, TRIGGER, sendStep, h.deps);
    expect(out.kind).toBe('awaiting_approval'); // drafted, not executed
    expect(sent).toBe(0); // no auto-send fired
  });

  it('P1-2: a NULL action_level fails SAFE to draft', async () => {
    const { h, nibRef } = actionHarness('send', 'student');
    (h.runs.nibbinState('nib-1') as { actionLevel: unknown }).actionLevel = null;
    let sent = 0;
    h.deps.effects = { async execute(req) { if (req.args.nativeDraft !== true) sent += 1; } };
    const out = await executeRun(nibRef, TRIGGER, sendStep, h.deps);
    expect(out.kind).toBe('awaiting_approval');
    expect(sent).toBe(0);
  });
});

describe('§ action-levels: retained safety walls fire under Egg+Send (dispatchStep)', () => {
  // The gate change is ONLY the draft-vs-execute DECISION. The retained walls
  // (resource claims, idempotency, velocity via effects executor) are unchanged
  // and must still fire when actionLevel='send'.
  //
  // We test these via executeRun with student (not egg) because executeRun
  // short-circuits at egg before dispatchStep. The walls are in dispatchStep,
  // not in the pre-run guard, so student+send is the correct harness here.

  const sendEffect: ProgramFn = async function* () {
    yield {
      kind: 'draft',
      capability: 'email.send',
      connectionId: CONN,
      patternKey: 'p-wall',
      title: 't',
      draft: 'd',
      effectArgs: { threadId: 'wall-t-1' },
    };
  };

  function wallHarness() {
    const h = harness({ credits: 1000 });
    h.runs.nibbinState('nib-1').actionLevel = 'send';
    return h;
  }

  const wallNib = (): NibbinRef => ({ ...nib(), stage: 'student' });
  const wallEvent = { kind: 'event' as const, key: 'wall-e', dedupeKey: 'wall-evt-1' };

  it('Egg+Send (student+send): dedupes on idempotency — effect fires exactly once across replayed triggers', async () => {
    const h = wallHarness();
    let executions = 0;
    h.deps.effects = { async execute() { executions += 1; } };

    const first = await executeRun(wallNib(), wallEvent, sendEffect, h.deps);
    expect(first.kind).toBe('executed');
    expect(executions).toBe(1);

    // Replay the same event (zero debounce): same idempotency key → deduped
    const replaySpec = spec({ triggers: [{ kind: 'event', source: 'e', debounceSecs: 0, cooldownSecs: 0 }] });
    const again = await executeRun({ ...wallNib(), spec: replaySpec }, wallEvent, sendEffect, h.deps);
    expect(again.kind).toBe('executed');
    expect(executions).toBe(1); // still 1 — idempotency wall held
  });

  it('Egg+Send (student+send): blocks on a held resource claim (conflict detection)', async () => {
    const h = wallHarness();
    const claims = new MemoryResourceClaimStore();
    h.deps.claims = claims;

    // Pre-claim the resource from a DIFFERENT run (simulating another active run)
    await claims.claim({
      accountId: ACCOUNT,
      nibbinId: 'holder-nib',
      runId: 'holder-run',
      resourceType: 'email',
      resourceId: 'wall-t-1',
    });

    let executions = 0;
    h.deps.effects = { async execute() { executions += 1; } };

    const out = await executeRun(wallNib(), wallEvent, sendEffect, h.deps);
    // Resource conflict → run completes but effect is skipped
    expect(out.kind).toBe('completed');
    expect((out as { resourceConflict?: unknown }).resourceConflict).toBeDefined();
    expect(executions).toBe(0); // effect did NOT fire — resource wall held
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

describe('#43: status re-checked mid-run — paused/level-lowered Nibbin drafts not executes', () => {
  // CONVERTED (Task 2): stage is no longer the execution gate; actionLevel is.
  // Mid-run re-read now protects against: (a) status change (pause/sleep) and
  // (b) actionLevel downgrade (send→draft or send→observe).
  // A stage demotion alone no longer causes drafting — only actionLevel or status changes do.
  function grantedHarness() {
    const runs = new MemoryRunStore(() => Date.now());
    runs.seedCredits(ACCOUNT, 1000);
    // actionLevel='send' so the run can reach the execute path
    runs.nibbinState('nib-1').actionLevel = 'send';
    const routines = new MemoryRoutineStore();
    const grants = new MemoryGrantStore();
    grants.grant('nib-1', CONN, 'email.send');
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
      capability: 'email.send',
      connectionId: CONN,
      patternKey: 'p1',
      title: 't',
      draft: 'd',
      effectArgs: { threadId: 't-1' },
    };
  };

  it('a nibbin with actionLevel=send executes normally (no mid-run change)', async () => {
    // CONVERTED: was "a grad run executes normally when no demotion occurs".
    // Now: any stage + actionLevel=send executes. Using 'student' to prove grade is irrelevant.
    const { deps } = grantedHarness();
    const studentNib: NibbinRef = { id: 'nib-1', accountId: ACCOUNT, name: 'Echo', stage: 'student', stageChangedAt: 0, status: 'active', spec: spec() };
    const outcome = await executeRun(studentNib, TRIGGER, draftStep, deps);
    expect(outcome.kind).toBe('executed');
  });

  it('action level lowered mid-run (send→draft) drafts instead of executing', async () => {
    // CONVERTED: was "grad demoted mid-run (stage flipped to student) drafts".
    // NEW model: actionLevel is the gate. Flipping actionLevel from 'send' to
    // 'draft' mid-run (simulating a concurrent owner permission change) causes
    // the runner to draft — getNibbin re-reads actionLevel fresh before execution.
    const { deps, runs } = grantedHarness();
    const nibRef: NibbinRef = { id: 'nib-1', accountId: ACCOUNT, name: 'Echo', stage: 'grad', stageChangedAt: 0, status: 'active', spec: spec() };
    const program: ProgramFn = async function* () {
      // Lower actionLevel inside the program, simulating a concurrent owner change
      runs.nibbinState('nib-1').actionLevel = 'draft';
      yield {
        kind: 'draft',
        capability: 'email.send',
        connectionId: CONN,
        patternKey: 'p1',
        title: 't',
        draft: 'd',
        effectArgs: { threadId: 't-1' },
      };
    };
    const outcome = await executeRun(nibRef, TRIGGER, program, deps);
    // freshly-read actionLevel is 'draft' → draft, not execute
    expect(outcome.kind).toBe('awaiting_approval');
  });

  it('a nibbin paused mid-run (store status flipped to paused) also drafts instead of executing', async () => {
    // Status guard is UNCHANGED — a paused/sleeping nibbin still drafts.
    const { deps, runs } = grantedHarness();
    const nibRef: NibbinRef = { id: 'nib-1', accountId: ACCOUNT, name: 'Echo', stage: 'grad', stageChangedAt: 0, status: 'active', spec: spec() };
    const program: ProgramFn = async function* () {
      // Simulate a concurrent pause between admission and execute
      runs.nibbinState('nib-1').status = 'paused';
      yield {
        kind: 'draft',
        capability: 'email.send',
        connectionId: CONN,
        patternKey: 'p1',
        title: 't',
        draft: 'd',
        effectArgs: { threadId: 't-1' },
      };
    };
    const outcome = await executeRun(nibRef, TRIGGER, program, deps);
    expect(outcome.kind).toBe('awaiting_approval');
  });
});

describe('#44: routine-pattern trust resets on demotion (stage-scoped approvals)', () => {
  // These first two tests verify MemoryRoutineStore math — they remain valid
  // unit tests of the approval-counting logic (used by the UI/promotion path).
  // The runner no longer reads routineApprovals in the gate decision (Task 2),
  // but the store logic itself is unchanged and must continue to work correctly.
  const DEMOTION_AT = 1_000_000; // ms timestamp simulating when demotion happened

  function stageHarness(now = () => Date.now()) {
    const runs = new MemoryRunStore(now);
    runs.seedCredits(ACCOUNT, 1000);
    const routines = new MemoryRoutineStore(now);
    const grants = new MemoryGrantStore();
    grants.grant('nib-1', CONN, 'email.send');
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

  it('CONVERTED: actionLevel=draft drafts regardless of grade or routine approvals', async () => {
    // CONVERTED: was "senior whose pattern was approved pre-demotion does not
    // regain autonomy after re-promotion". OLD model: runner read routineApprovals
    // and gated on them. NEW model: runner ignores routineApprovals — actionLevel
    // is the sole gate. A nibbin with actionLevel=draft always drafts even if
    // routineApprovals >= routineMinApprovals and stage='senior'.
    let t = 0;
    const { deps, runs, routines } = stageHarness(() => t);

    // Seed 5 post-promotion approvals (> routineMinApprovals)
    t = DEMOTION_AT + 1000;
    for (let i = 0; i < 5; i++) routines.approve('nib-1', 'p1');

    // actionLevel defaults to 'draft' in the store — explicitly confirm
    runs.nibbinState('nib-1').actionLevel = 'draft';

    const seniorNib: NibbinRef = {
      id: 'nib-1',
      accountId: ACCOUNT,
      name: 'Echo',
      stage: 'senior',
      stageChangedAt: DEMOTION_AT,
      status: 'active',
      spec: spec(),
    };

    t = DEMOTION_AT + 2000;
    const outcome = await executeRun(seniorNib, TRIGGER, async function* () {
      yield {
        kind: 'draft',
        capability: 'email.send',
        connectionId: CONN,
        patternKey: 'p1',
        title: 't',
        draft: 'd',
        effectArgs: { threadId: 't-1' },
      };
    }, deps);
    // actionLevel='draft' → always drafts, regardless of routineApprovals or stage
    expect(outcome.kind).toBe('awaiting_approval');
    void runs;
  });
});

// ── Task 6: lock — dispatchStep outcome is invariant to stage (grade never gates) ─────────────
// Parametrized proof: the SAME step with a FIXED actionLevel yields the SAME
// outcome at every non-egg stage (student / senior / grad). Grade is purely a
// report-card label; it has zero influence on the draft-vs-execute decision.
describe('Task 6 lock: dispatchStep outcome is invariant to stage for a fixed actionLevel', () => {
  // Stages the runner can actually process (egg is short-circuited at pre-run).
  const runnableStages = ['student', 'senior', 'grad'] as const;

  const draftYield: ProgramFn = async function* () {
    yield {
      kind: 'draft',
      capability: 'email.send',
      connectionId: CONN,
      patternKey: 'p-lock',
      title: 'Lock test email',
      draft: 'Body',
      effectArgs: { threadId: 't-lock-1' },
    };
  };

  function lockHarness(actionLevel: 'observe' | 'draft' | 'send', stage: NibbinRef['stage']) {
    const h = harness({ credits: 1000 });
    h.runs.nibbinState('nib-1').actionLevel = actionLevel;
    const nibRef: NibbinRef = { ...nib(), stage };
    return { h, nibRef };
  }

  it.each(runnableStages)(
    'actionLevel=send + stage=%s → executed (grade never gates)',
    async (stage) => {
      const { h, nibRef } = lockHarness('send', stage);
      let executed = 0;
      h.deps.effects = { async execute() { executed += 1; } };
      const out = await executeRun(nibRef, TRIGGER, draftYield, h.deps);
      expect(out.kind).toBe('executed');
      expect(executed).toBe(1);
    },
  );

  it.each(runnableStages)(
    'actionLevel=draft + stage=%s → drafted (grade never gates)',
    async (stage) => {
      const { h, nibRef } = lockHarness('draft', stage);
      let sent = 0;
      // Count only real SENDS. An email.send draft step now legitimately calls
      // the executor once for the native-draft MIRROR (createDraft, nativeDraft:true)
      // — that is draft creation, NOT a send. The draft outcome proves no send.
      h.deps.effects = { async execute(req) { if (req.args.nativeDraft !== true) sent += 1; } };
      const out = await executeRun(nibRef, TRIGGER, draftYield, h.deps);
      expect(out.kind).toBe('awaiting_approval');
      expect(sent).toBe(0); // no send fired
    },
  );

  it.each(runnableStages)(
    'actionLevel=observe + stage=%s → kill:observe (grade never gates)',
    async (stage) => {
      const { h, nibRef } = lockHarness('observe', stage);
      let executed = 0;
      h.deps.effects = { async execute() { executed += 1; } };
      const out = await executeRun(nibRef, TRIGGER, draftYield, h.deps);
      expect(out.kind).toBe('killed');
      expect((out as { reason: string }).reason).toBe('observe');
      expect(executed).toBe(0);
    },
  );
});

// ── Task 4: native-draft mirror — END-TO-END via a REAL primitive ─────────────
// FIX 5 (P1-1 / F1 / red-team P1-2): the prior 4 tests were tautologies — they
// hand-injected `nativeDraft`/`nativeDraftRef`/`dismiss` into the program's
// effectArgs and asserted a mock saw them. But NO real primitive sets those
// flags, and the runner now reads `nativeDraft` from the capability DESCRIPTOR,
// NOT from effectArgs. These replacements drive the REAL `nudgeOverdueEmail`
// primitive (which yields email.send with effectArgs {threadId,to,subject} —
// zero native-draft flags) and assert the wired feature:
//   • the runner creates a Gmail draft at Draft level (descriptor.nativeDraft===true)
//   • the returned id is persisted to run_steps.payload.nativeDraftRef
//   • a re-run does NOT create a second draft (idempotency/orphan guard)
//   • a calendar primitive (descriptor.nativeDraft===false) creates NO native draft
describe('Task 4: native-draft mirror is wired end-to-end (real primitive, descriptor-driven)', () => {
  const GMAIL = 'gmail-conn';
  const OLD = Date.now() - 10 * 86_400_000; // 10 days ago → overdue

  // A reader that yields one overdue inbound thread, no matching sent reply, so
  // nudgeOverdueEmail produces exactly one email.send draft step.
  function overdueMailboxReader() {
    return {
      async read(_c: string, _cap: string, path: string) {
        if (path.includes('in%3Ainbox') || path.includes('in:inbox')) {
          return quarantine(JSON.stringify({ messages: [{ id: 'msg-1' }] }), `gmail:list:inbox`);
        }
        if (path.includes('in%3Asent') || path.includes('in:sent')) {
          return quarantine(JSON.stringify({ messages: [] }), `gmail:list:sent`);
        }
        // metadata fetch for a specific message id
        return quarantine(
          JSON.stringify({
            id: 'msg-1',
            threadId: 'thread-1',
            internalDate: String(OLD),
            payload: { headers: [
              { name: 'From', value: 'Pat <pat@example.com>' },
              { name: 'Subject', value: 'Our proposal' },
            ] },
          }),
          `gmail:meta:msg-1`,
        );
      },
    };
  }

  function harnessFor(opts: {
    actionLevel: 'observe' | 'draft' | 'send';
    idempotency?: MemoryIdempotencyStore;
    reader?: { read(c: string, cap: string, path: string): Promise<ReturnType<typeof quarantine>> };
  }) {
    const runs = new MemoryRunStore(() => Date.now());
    runs.seedCredits(ACCOUNT, 1000);
    runs.nibbinState('nib-1').actionLevel = opts.actionLevel;
    const createDraftCalls: Array<Record<string, unknown>> = [];
    let nextDraftId = 'gmail-draft-1';
    const deps: RunnerDeps = {
      runs,
      routines: new MemoryRoutineStore(),
      grants: new MemoryGrantStore(),
      idempotency: opts.idempotency ?? new MemoryIdempotencyStore(),
      events: new MemoryEventSink(),
      reader: opts.reader ?? overdueMailboxReader(),
      effects: {
        async execute(req) {
          createDraftCalls.push(req.args);
          // Mirror the production executor: only the nativeDraft path returns an id.
          if (req.args.nativeDraft === true) return { nativeDraftId: nextDraftId };
          return undefined;
        },
      },
      now: () => Date.now(),
    };
    return { deps, runs, createDraftCalls, setDraftId: (id: string) => { nextDraftId = id; } };
  }

  it('creates a Gmail draft at Draft level from the DESCRIPTOR (effectArgs carry no nativeDraft flag) and persists the ref', async () => {
    const { deps, runs, createDraftCalls } = harnessFor({ actionLevel: 'draft' });
    const program: ProgramFn = ({ nibbin }) =>
      nudgeOverdueEmail({}, { gmail: GMAIL }, Date.now())({ nibbin, trigger: TRIGGER });

    const outcome = await executeRun(nib(), TRIGGER, program, deps);
    expect(outcome.kind).toBe('awaiting_approval');
    // Exactly one executor call — the native-draft createDraft (gated on the
    // descriptor, NOT on an effectArgs flag the primitive never sets).
    expect(createDraftCalls).toHaveLength(1);
    expect(createDraftCalls[0].nativeDraft).toBe(true);
    // The ref is persisted on the draft step.
    const runId = (outcome as { runId: string }).runId;
    const draftStep = runs.getSteps(runId).find((s) => s.kind === 'draft');
    expect(draftStep?.payload?.nativeDraftRef).toBe('gmail-draft-1');
  });

  it('a re-run does NOT create a second Gmail draft (orphan/idempotency guard, F1)', async () => {
    // Share one idempotency store across two run attempts of the same logical
    // draft. The second attempt must see already_executed and skip createDraft.
    const idem = new MemoryIdempotencyStore();
    const h1 = harnessFor({ actionLevel: 'draft', idempotency: idem });
    const program1: ProgramFn = ({ nibbin }) =>
      nudgeOverdueEmail({}, { gmail: GMAIL }, Date.now())({ nibbin, trigger: TRIGGER });
    await executeRun(nib(), TRIGGER, program1, h1.deps);
    expect(h1.createDraftCalls).toHaveLength(1);

    // Second attempt (e.g. a lambda re-invoke) with the SAME idempotency store.
    const h2 = harnessFor({ actionLevel: 'draft', idempotency: idem });
    const program2: ProgramFn = ({ nibbin }) =>
      nudgeOverdueEmail({}, { gmail: GMAIL }, Date.now())({ nibbin, trigger: TRIGGER });
    await executeRun(nib(), TRIGGER, program2, h2.deps);
    // No second createDraft — the native-draft key was already claimed.
    expect(h2.createDraftCalls).toHaveLength(0);
  });

  it('calendar primitive (descriptor.nativeDraft===false) creates NO native draft at Draft level', async () => {
    // nudge.unconfirmed-event drafts via calendar.event-create (nativeDraft:false).
    // Use a hand-built program yielding a calendar.event-create draft step — the
    // descriptor's nativeDraft:false must keep the executor un-called at draft.
    const calSpecLocal = spec({
      toolsAllowlist: ['calendar.read', 'calendar.event-create'],
      requiredConnectors: ['google-calendar'],
    });
    const { deps, runs, createDraftCalls } = harnessFor({ actionLevel: 'draft' });
    const program: ProgramFn = async function* () {
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
    const outcome = await executeRun(nib(calSpecLocal), TRIGGER, program, deps);
    expect(outcome.kind).toBe('awaiting_approval');
    expect(createDraftCalls).toHaveLength(0); // nativeDraft:false → no native draft
    const runId = (outcome as { runId: string }).runId;
    const draftStep = runs.getSteps(runId).find((s) => s.kind === 'draft');
    expect(draftStep?.payload?.nativeDraftRef).toBeUndefined();
  });
});
