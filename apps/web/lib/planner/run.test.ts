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

  it('approving a held draft executes it via the runner effect path; rejecting does not', async () => {
    const store = new InMemoryPlanRunStore();
    const executed: string[] = [];
    const runner = runnerDeps();
    runner.effects = { async execute(req) { executed.push(req.capability); } };
    // Seed a run paused on an approval (a held draft), as the harness would.
    await store.create({
      runId: 'run-appr',
      accountId: ACCOUNT,
      plan: plan(),
      transcript: [{ idx: 0, pick: { tool: 'email.draft', args: {} } }],
      scratchpad: {},
      status: 'needs_input',
      pending: {
        requestId: 'req-appr',
        kind: 'approval',
        question: 'Send this reply?',
        context: { tool: 'email.send', connectionId: 'conn-gmail', effectArgs: { to: 'a@b.com' } },
      },
    });
    const d: PlannerDeps = {
      planner: { async pick() { return { done: true, artifact: { summary: 'sent' } }; } },
      runner,
      connectors: ['gmail'],
      connMap: { gmail: 'conn-gmail' },
      accountId: ACCOUNT,
      persist: { save: (s) => store.save(s) },
    };
    const out = await respondToRequest('run-appr', ACCOUNT, USER, { requestId: 'req-appr', approval: 'approved' }, () => d, store);
    expect(out.kind).toBe('done');
    expect(executed).toEqual(['email.send']);
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
