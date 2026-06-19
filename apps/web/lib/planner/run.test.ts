/**
 * Planner resumable run state (Slice 3a, design §3): a run pauses on ask_human
 * / approval as a needs_input, persists, and respondToRequest rehydrates +
 * resumes. Idempotent on a resolved request; account-scoped (a foreign runId
 * cannot be loaded or resumed).
 */
import { describe, expect, it } from 'vitest';
import { quarantine } from '@nibbin/connectors';
import {
  MemoryEventSink,
  MemoryGrantStore,
  MemoryIdempotencyStore,
  MemoryRoutineStore,
  MemoryRunStore,
  type PlanRunState,
  type PlanSpec,
  type PlannerDeps,
  type PlannerDrafter,
  type RunnerDeps,
} from '@nibbin/runtime';
import { InMemoryPlanRunStore, respondToRequest } from './run';

const ACCOUNT = 'acct-1';
const OTHER = 'acct-2';
const USER = 'user-1';

function plan(overrides: Partial<PlanSpec> = {}): PlanSpec {
  return {
    kind: 'plan',
    ephemeral: true,
    goal: 'find the answer',
    intendedSteps: ['ask'],
    toolsAllowlist: ['email.read', 'done'],
    requiredConnectors: ['gmail'],
    weightClass: 'frontier',
    ceilings: { maxSteps: 60, maxTokens: 8000, maxWallClockMs: 60_000, maxIterations: 12 },
    ...overrides,
  };
}

function runnerDeps(): RunnerDeps {
  const runs = new MemoryRunStore();
  runs.seedCredits(ACCOUNT, 1000);
  runs.recordStep = async () => {};
  return {
    runs,
    routines: new MemoryRoutineStore(),
    grants: new MemoryGrantStore(),
    idempotency: new MemoryIdempotencyStore(),
    events: new MemoryEventSink(),
    reader: { async read(_c, _cap, path) { return quarantine('{"ok":true}', `gmail:x:${path}`); } },
    effects: { async execute() {} },
    now: () => Date.now(),
  };
}

/** A picker driven by the transcript so it behaves correctly across a resume:
 *  it asks once, and after it sees the human answer observation, it finishes. */
function resumablePicker(): PlannerDrafter {
  return {
    async pick({ transcript }) {
      const asked = transcript.some((t) => 'ask_human' in t.pick);
      const answered = transcript.some((t) => 'ask_human' in t.pick && t.observation);
      if (!asked) return { ask_human: true, kind: 'value', question: 'which inbox?' };
      if (answered) return { done: true, artifact: { summary: 'done with the answer' } };
      // asked but not yet answered — should not happen mid-pause
      return { done: true, artifact: { summary: 'fallback' } };
    },
  };
}

function deps(planner: PlannerDrafter, store: InMemoryPlanRunStore, runner: RunnerDeps): PlannerDeps {
  return {
    planner,
    runner,
    connectors: ['gmail'],
    connMap: { gmail: 'conn-gmail' },
    accountId: ACCOUNT,
    persist: { save: (s) => store.save(s) },
    newRunId: () => 'run-fixed',
    newRequestId: () => 'req-fixed',
  };
}

async function startPaused(store: InMemoryPlanRunStore, d: PlannerDeps): Promise<PlanRunState> {
  const { runPlan } = await import('@nibbin/runtime');
  await store.create({
    runId: 'run-fixed',
    accountId: ACCOUNT,
    plan: plan(),
    transcript: [],
    scratchpad: {},
    status: 'running',
  });
  const outcome = await runPlan(plan(), d);
  expect(outcome.kind).toBe('needs_input');
  return (await store.load('run-fixed', ACCOUNT))!;
}

describe('respondToRequest — pause + resume', () => {
  it('ask_human pauses as needs_input; responding resumes to done', async () => {
    const store = new InMemoryPlanRunStore();
    const runner = runnerDeps();
    const d = deps(resumablePicker(), store, runner);
    const paused = await startPaused(store, d);
    expect(paused.status).toBe('needs_input');
    expect(paused.pending?.kind).toBe('value');

    const resumed = await respondToRequest('run-fixed', ACCOUNT, USER, { requestId: 'req-fixed', value: 'primary inbox' }, () => d, store);
    expect(resumed.kind).toBe('done');
  });

  it('is idempotent on an already-resolved request (returns terminal, no re-run)', async () => {
    const store = new InMemoryPlanRunStore();
    const runner = runnerDeps();
    const d = deps(resumablePicker(), store, runner);
    await startPaused(store, d);
    const first = await respondToRequest('run-fixed', ACCOUNT, USER, { requestId: 'req-fixed', value: 'x' }, () => d, store);
    expect(first.kind).toBe('done');
    // a second response to the same (now resolved) request must not re-run
    const second = await respondToRequest('run-fixed', ACCOUNT, USER, { requestId: 'req-fixed', value: 'x' }, () => d, store);
    expect(second.kind).toBe('done');
  });

  // A draft-class capability IN the plan's allowlist: legitimate to approval-
  // execute. `email.draft` is sideEffect:'draft' in the registry.
  const APPROVAL_PLAN = plan({ toolsAllowlist: ['email.read', 'email.draft', 'done'] });

  function seedApproval(store: InMemoryPlanRunStore, tool: string, runId = 'run-appr', requestId = 'req-appr') {
    return store.create({
      runId,
      accountId: ACCOUNT,
      plan: APPROVAL_PLAN,
      transcript: [{ idx: 0, pick: { tool: 'email.draft', args: {} } }],
      scratchpad: {},
      status: 'needs_input',
      pending: {
        requestId,
        kind: 'approval',
        question: 'Send this reply?',
        context: { tool, connectionId: 'conn-gmail', effectArgs: { to: 'a@b.com' } },
      },
    });
  }

  function approvalDeps(store: InMemoryPlanRunStore, runner: RunnerDeps): PlannerDeps {
    return {
      planner: { async pick() { return { done: true, artifact: { summary: 'sent' } }; } },
      runner,
      connectors: ['gmail'],
      connMap: { gmail: 'conn-gmail' },
      accountId: ACCOUNT,
      persist: { save: (s) => store.save(s) },
    };
  }

  it('approving a held DRAFT-class cap executes it via the runner effect path', async () => {
    const store = new InMemoryPlanRunStore();
    const executed: string[] = [];
    const runner = runnerDeps();
    runner.effects = { async execute(req) { executed.push(req.capability); } };
    await seedApproval(store, 'email.draft');
    const d = approvalDeps(store, runner);
    const out = await respondToRequest('run-appr', ACCOUNT, USER, { requestId: 'req-appr', approval: 'approved' }, () => d, store);
    expect(out.kind).toBe('done');
    expect(executed).toEqual(['email.draft']);
  });

  // FIX 9 (reject branch): a `rejected` approval does NOT execute, appends a
  // "rejected" observation, and the loop continues to completion.
  it('rejecting a held draft does NOT execute; appends a rejected observation; loop continues', async () => {
    const store = new InMemoryPlanRunStore();
    const executed: string[] = [];
    const runner = runnerDeps();
    runner.effects = { async execute(req) { executed.push(req.capability); } };
    await seedApproval(store, 'email.draft');
    const d = approvalDeps(store, runner);
    const out = await respondToRequest('run-appr', ACCOUNT, USER, { requestId: 'req-appr', approval: 'rejected' }, () => d, store);
    expect(out.kind).toBe('done'); // the loop continued and the picker called done
    expect(executed).toEqual([]); // nothing executed on reject
    const after = await store.load('run-appr', ACCOUNT);
    const draftTurn = after!.transcript.find((t) => 'tool' in t.pick && t.pick.tool === 'email.draft');
    expect(draftTurn?.observation).toMatch(/rejected/i);
  });

  // FIX 1: a held write-class tool (and/or off-surface) is REFUSED on approval.
  it('refuses approval-execute of a WRITE-class held tool (email.send): nothing executed, run failed', async () => {
    const store = new InMemoryPlanRunStore();
    const executed: string[] = [];
    const runner = runnerDeps();
    runner.effects = { async execute(req) { executed.push(req.capability); } };
    // email.send is sideEffect:'write' AND not in APPROVAL_PLAN's allowlist.
    await seedApproval(store, 'email.send');
    const d = approvalDeps(store, runner);
    const out = await respondToRequest('run-appr', ACCOUNT, USER, { requestId: 'req-appr', approval: 'approved' }, () => d, store);
    expect(out.kind).toBe('failed');
    expect(executed).toEqual([]);
    const after = await store.load('run-appr', ACCOUNT);
    expect(after!.status).toBe('failed');
  });

  // FIX 2: a double-resume of the same approval executes the effect AT MOST ONCE.
  it('double-resume of the same approval executes at most once', async () => {
    const store = new InMemoryPlanRunStore();
    const executed: string[] = [];
    const runner = runnerDeps();
    runner.effects = { async execute(req) { executed.push(req.capability); } };
    await seedApproval(store, 'email.draft');
    const d = approvalDeps(store, runner);
    // drive two resolves concurrently against the same pending request
    const [a, b] = await Promise.all([
      respondToRequest('run-appr', ACCOUNT, USER, { requestId: 'req-appr', approval: 'approved' }, () => d, store),
      respondToRequest('run-appr', ACCOUNT, USER, { requestId: 'req-appr', approval: 'approved' }, () => d, store),
    ]);
    expect([a.kind, b.kind]).toContain('done');
    expect(executed).toEqual(['email.draft']); // exactly one send
  });

  it('a foreign account cannot load or resume another account run', async () => {
    const store = new InMemoryPlanRunStore();
    const runner = runnerDeps();
    const d = deps(resumablePicker(), store, runner);
    await startPaused(store, d);
    const out = await respondToRequest('run-fixed', OTHER, USER, { requestId: 'req-fixed', value: 'x' }, () => d, store);
    expect(out.kind).toBe('failed');
    // the run is untouched (still needs_input under its real owner)
    const still = await store.load('run-fixed', ACCOUNT);
    expect(still?.status).toBe('needs_input');
  });
});

/* ── computer_use (browser) approval → commit via the BrowserDriver ──────────── */

describe('respondToRequest — computer_use write approval commits via the driver', () => {
  const CU_PLAN = plan({
    toolsAllowlist: ['computer_use.navigate', 'computer_use.click', 'done'],
    requiredConnectors: [],
    weightClass: 'computer_use',
  });

  /** A held click draft, mirroring what the harness pauses with. */
  function seedClickApproval(store: InMemoryPlanRunStore, target: Record<string, unknown>) {
    return store.create({
      runId: 'run-cu',
      accountId: ACCOUNT,
      plan: CU_PLAN,
      transcript: [{ idx: 0, pick: { tool: 'computer_use.click', args: { target } } }],
      scratchpad: {},
      status: 'needs_input',
      pending: {
        requestId: 'req-cu',
        kind: 'approval',
        question: 'Approve browser action: click selector "button#go"?',
        context: { tool: 'computer_use.click', computerUse: { verb: 'click', target }, summary: 'click selector "button#go"' },
      },
    });
  }

  function cuDeps(store: InMemoryPlanRunStore, commits: { verb: string; value?: string }[]): PlannerDeps {
    const runner = runnerDeps();
    return {
      planner: { async pick() { return { done: true, artifact: { summary: 'done' } }; } },
      runner,
      connectors: [],
      connMap: {},
      accountId: ACCOUNT,
      persist: { save: (s) => store.save(s) },
      // a minimal mock driver: records commits, never auto-acts
      browser: {
        async navigate() { return { kind: 'read', content: quarantine('p', 'browser:x') }; },
        async extract() { return { kind: 'read', content: quarantine('p', 'browser:x') }; },
        async screenshot() { return { kind: 'read', content: quarantine('p', 'browser:x') }; },
        async scroll() { return { kind: 'read', content: quarantine('p', 'browser:x') }; },
        async click() { return { kind: 'draft', summary: 'click' }; },
        async type() { return { kind: 'draft', summary: 'type' }; },
        async commit(verb, _t, value) { commits.push({ verb, value }); },
      },
      isPublicIp: () => true,
    };
  }

  it('approving a held click commits it via driver.commit; the loop continues to done', async () => {
    const store = new InMemoryPlanRunStore();
    const commits: { verb: string; value?: string }[] = [];
    await seedClickApproval(store, { selector: 'button#go' });
    const d = cuDeps(store, commits);
    const out = await respondToRequest('run-cu', ACCOUNT, USER, { requestId: 'req-cu', approval: 'approved' }, () => d, store);
    expect(out.kind).toBe('done');
    expect(commits).toEqual([{ verb: 'click', value: undefined }]);
  });

  it('rejecting a held click commits NOTHING', async () => {
    const store = new InMemoryPlanRunStore();
    const commits: { verb: string; value?: string }[] = [];
    await seedClickApproval(store, { selector: 'button#go' });
    const d = cuDeps(store, commits);
    const out = await respondToRequest('run-cu', ACCOUNT, USER, { requestId: 'req-cu', approval: 'rejected' }, () => d, store);
    expect(out.kind).toBe('done');
    expect(commits).toEqual([]);
  });

  it('double-resume commits the browser write at most once (idempotency)', async () => {
    const store = new InMemoryPlanRunStore();
    const commits: { verb: string; value?: string }[] = [];
    await seedClickApproval(store, { selector: 'button#go' });
    const d = cuDeps(store, commits);
    const [a, b] = await Promise.all([
      respondToRequest('run-cu', ACCOUNT, USER, { requestId: 'req-cu', approval: 'approved' }, () => d, store),
      respondToRequest('run-cu', ACCOUNT, USER, { requestId: 'req-cu', approval: 'approved' }, () => d, store),
    ]);
    expect([a.kind, b.kind]).toContain('done');
    expect(commits).toEqual([{ verb: 'click', value: undefined }]); // exactly one commit
  });
});
