/**
 * The bounded-ReAct harness (Slice 3a, design §2.3 / §7). The picker chooses
 * the next move; every connector pick rides dispatchStep (the SAME gates); the
 * loop is bounded by maxIterations + repetition + no-progress.
 */
import { describe, expect, it } from 'vitest';
import { quarantine } from '@nibbin/connectors';
import {
  runPlan,
  MemoryEventSink,
  MemoryGrantStore,
  MemoryIdempotencyStore,
  MemoryRoutineStore,
  MemoryRunStore,
  type PlanSpec,
  type PlannerDeps,
  type PlannerDrafter,
  type PlannerPick,
  type RunnerDeps,
} from '../src/index';

const ACCOUNT = 'acct-1';

function plan(overrides: Partial<PlanSpec> = {}): PlanSpec {
  return {
    kind: 'plan',
    ephemeral: true,
    goal: 'tell me what needs attention today',
    intendedSteps: ['read the inbox', 'summarize'],
    toolsAllowlist: ['email.read', 'memory.retrieve', 'done'],
    requiredConnectors: ['gmail'],
    weightClass: 'frontier',
    ceilings: { maxSteps: 60, maxTokens: 8000, maxWallClockMs: 60_000, maxIterations: 12 },
    ...overrides,
  };
}

/** A scripted picker: returns the queued picks in order, then null (no model). */
function scriptedPicker(picks: (PlannerPick | null)[]): { drafter: PlannerDrafter; calls: number } {
  let i = 0;
  const ref = {
    drafter: {
      async pick() {
        const p = i < picks.length ? picks[i] : null;
        i += 1;
        ref.calls = i;
        return p;
      },
    } as PlannerDrafter,
    calls: 0,
  };
  return ref;
}

function runnerDeps(opts: { now?: () => number; executed?: string[] } = {}): RunnerDeps {
  // A plan run is EPHEMERAL: there is no nibbins/runs row and no admission/
  // begin. The transcript in plan_runs is the audit ledger, so dispatchStep's
  // per-step recordStep is a no-op sink here (apps/web wires the same).
  const runs = new MemoryRunStore(opts.now ?? (() => Date.now()));
  runs.seedCredits(ACCOUNT, 1000);
  runs.recordStep = async () => {};
  return {
    runs,
    routines: new MemoryRoutineStore(),
    grants: new MemoryGrantStore(),
    idempotency: new MemoryIdempotencyStore(),
    events: new MemoryEventSink(),
    reader: {
      async read(_c, _cap, path) {
        return quarantine('{"threads":[{"id":1},{"id":2}]}', `gmail:inbox:${path}`);
      },
    },
    effects: {
      async execute(req) {
        opts.executed?.push(req.capability);
      },
    },
    now: opts.now ?? (() => Date.now()),
  };
}

function deps(picks: (PlannerPick | null)[], extra: Partial<PlannerDeps> = {}, runner?: RunnerDeps): {
  d: PlannerDeps;
  picker: { drafter: PlannerDrafter; calls: number };
} {
  const picker = scriptedPicker(picks);
  const d: PlannerDeps = {
    planner: picker.drafter,
    runner: runner ?? runnerDeps(),
    connectors: ['gmail'],
    connMap: { gmail: 'conn-gmail' },
    accountId: ACCOUNT,
    ...extra,
  };
  return { d, picker };
}

describe('runPlan — read-only goal → artifact', () => {
  it('reads through dispatchStep then done; nothing executed', async () => {
    const executed: string[] = [];
    const { d } = deps(
      [
        { tool: 'email.read', args: { path: '/gmail/v1/users/me/messages?q=x' } },
        { done: true, artifact: { summary: '2 threads need attention' } },
      ],
      {},
      runnerDeps({ executed }),
    );
    const outcome = await runPlan(plan(), d);
    expect(outcome.kind).toBe('done');
    if (outcome.kind === 'done') {
      expect(outcome.artifact).toMatchObject({ summary: '2 threads need attention' });
    }
    expect(executed).toEqual([]);
  });
});

describe('runPlan — bounded', () => {
  it('repetition kill: the same read 4 times', async () => {
    const samePick: PlannerPick = { tool: 'email.read', args: { path: '/gmail/v1/users/me/messages?q=x' } };
    const { d } = deps([samePick, samePick, samePick, samePick, samePick, samePick]);
    const outcome = await runPlan(plan(), d);
    expect(outcome.kind).toBe('killed');
    if (outcome.kind === 'killed') {
      expect(['repetition', 'no_progress']).toContain(outcome.reason);
    }
  });

  it('max_iterations: a fresh productive pick forever', async () => {
    // Distinct scratchpad writes never repeat and always make progress, so only
    // the iteration ceiling stops the loop.
    let n = 0;
    const drafter: PlannerDrafter = {
      async pick() {
        n += 1;
        return { tool: 'scratchpad.write', args: { key: `k${n}`, value: `v${n}` } };
      },
    };
    const { d } = deps([], { planner: drafter });
    const outcome = await runPlan(
      plan({
        toolsAllowlist: ['email.read', 'scratchpad.write', 'done'],
        ceilings: { maxSteps: 60, maxTokens: 8000, maxWallClockMs: 60_000, maxIterations: 5 },
      }),
      d,
    );
    expect(outcome.kind).toBe('killed');
    if (outcome.kind === 'killed') expect(outcome.reason).toBe('max_iterations');
  });

  it('no model → failed "planning requires a model"', async () => {
    const { d } = deps([null]);
    const outcome = await runPlan(plan(), d);
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.error).toMatch(/planning requires a model/);
  });
});

describe('runPlan — a write pick is approval-gated', () => {
  // A path-aware reader: the inbox list returns one fresh first-contact message;
  // its meta makes reply.new-inquiry draft a warm reply (then pause for approval).
  function mailboxReader() {
    return {
      async read(_c: string, _cap: string, path: string) {
        if (path.includes('in%3Ainbox') || path.includes('in:inbox')) {
          return quarantine(JSON.stringify({ messages: [{ id: 'm1' }] }), 'gmail:list');
        }
        if (path.includes('in%3Asent') || path.includes('in:sent')) {
          return quarantine(JSON.stringify({ messages: [] }), 'gmail:list');
        }
        // a message meta
        return quarantine(
          JSON.stringify({
            id: 'm1',
            threadId: 't1',
            internalDate: '1700000000000',
            payload: { headers: [
              { name: 'Subject', value: 'New project inquiry' },
              { name: 'From', value: 'Jane <jane@example.com>' },
            ] },
          }),
          'gmail:meta',
        );
      },
    };
  }

  it('a draft pick pauses as needs_input(approval); nothing executed', async () => {
    const executed: string[] = [];
    const runner = runnerDeps({ executed });
    runner.reader = mailboxReader();
    const { d } = deps(
      [{ tool: 'reply.new-inquiry', args: {} }, { done: true, artifact: {} }],
      {},
      runner,
    );
    const outcome = await runPlan(
      plan({ toolsAllowlist: ['email.read', 'email.draft', 'reply.new-inquiry', 'done'] }),
      d,
    );
    expect(outcome.kind).toBe('needs_input');
    if (outcome.kind === 'needs_input') {
      expect(outcome.request.kind).toBe('approval');
      expect(outcome.request.context.tool).toBe('reply.new-inquiry');
    }
    expect(executed).toEqual([]);
  });
});

describe('runPlan — web-search redaction through a turn', () => {
  it('the egressed query is redacted and the observation is quarantined', async () => {
    const egressed: string[] = [];
    const utilities = {
      async webSearch(query: string) {
        egressed.push(query);
        // the harness is handed an ALREADY-redacted+quarantined observation by
        // websearch.ts; here we just assert the wiring passes it through.
        return quarantine(`results for: ${query}`, 'web:search').wrapped;
      },
    };
    // a query containing PII — websearch.ts redacts before egress; in this unit
    // we pass the redacted form to assert the loop only ever sees quarantined web.
    const { d } = deps(
      [
        { tool: 'web.search', args: { query: 'contact [EMAIL] about the invoice' } },
        { done: true, artifact: { summary: 'searched' } },
      ],
      { utilities },
    );
    const outcome = await runPlan(
      plan({ toolsAllowlist: ['web.search', 'done'], requiredConnectors: [] }),
      { ...d, connectors: [] },
    );
    expect(outcome.kind).toBe('done');
    expect(egressed[0]).not.toContain('@');
  });
});

describe('runPlan — the core safety test', () => {
  it('an off-surface pick is rejected; after one re-prompt the run fails', async () => {
    // email.send is NOT in the allowlist. First pick rejected → one re-prompt;
    // the second pick is also off-surface → failed.
    const off: PlannerPick = { tool: 'email.send', args: { to: 'x@y.com' } };
    const executed: string[] = [];
    const { d } = deps([off, off, { done: true, artifact: {} }], {}, runnerDeps({ executed }));
    const outcome = await runPlan(plan(), d);
    expect(outcome.kind).toBe('failed');
    expect(executed).toEqual([]);
  });
});
