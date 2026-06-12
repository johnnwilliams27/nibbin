/**
 * §7.2 trust-gate suite: attempt side effects from every stage below Graduate
 * via every path (direct event trigger, Grovekeeper delegation, schedule) —
 * all must yield drafts/approvals, never executions. Senior autonomy exists
 * only for routine patterns repeatedly matched AND structurally granted (C8
 * write-grant rows, issue #26).
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
  type AgentSpec,
  type NibbinRef,
  type ProgramFn,
  type RunnerDeps,
  type RunTrigger,
  type StageName,
} from '../src/index';

const ACCOUNT = 'acct-1';
const CONN = 'conn-gmail';

function testSpec(): AgentSpec {
  return {
    templateKey: 'echo',
    version: 1,
    displayName: 'Echo',
    toolsAllowlist: ['email.read', 'email.draft'],
    requiredConnectors: ['gmail'],
    triggers: [
      { kind: 'user', debounceSecs: 0, cooldownSecs: 0 },
      { kind: 'schedule', schedule: 'daily.morning', debounceSecs: 0, cooldownSecs: 0 },
      { kind: 'event', source: 'connector:gmail:thread.overdue', debounceSecs: 0, cooldownSecs: 0 },
    ],
    curriculum: {
      measures: 'test',
      promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95 },
      routineMinApprovals: 5,
    },
    creditProfile: { weightClass: 'standard', ceilings: { maxSteps: 10, maxTokens: 1000, maxWallClockMs: 60_000 } },
  };
}

function nibbin(stage: StageName): NibbinRef {
  return { id: 'nib-1', accountId: ACCOUNT, name: 'Echo', stage, status: 'active', spec: testSpec() };
}

/** A program that proposes one real side effect. */
const effectProgram: ProgramFn = async function* () {
  yield {
    kind: 'draft',
    capability: 'email.draft',
    connectionId: CONN,
    patternKey: 'email.draft:overdue-followup',
    title: 'Follow-up',
    draft: 'Hi — picking this back up.',
    effectArgs: { threadId: 't-1' },
  };
};

interface Harness {
  deps: RunnerDeps;
  runs: MemoryRunStore;
  routines: MemoryRoutineStore;
  grants: MemoryGrantStore;
  executed: Array<{ capability: string }>;
}

function harness(credits = 100): Harness {
  const runs = new MemoryRunStore(() => Date.now());
  runs.seedCredits(ACCOUNT, credits);
  const routines = new MemoryRoutineStore();
  const grants = new MemoryGrantStore();
  const executed: Array<{ capability: string }> = [];
  const deps: RunnerDeps = {
    runs,
    routines,
    grants,
    idempotency: new MemoryIdempotencyStore(),
    events: new MemoryEventSink(),
    reader: {
      async read(_c, _cap, path) {
        return quarantine('{}', `gmail:test:${path}`);
      },
    },
    effects: {
      async execute(req) {
        executed.push({ capability: req.capability });
      },
    },
    now: () => Date.now(),
  };
  return { deps, runs, routines, grants, executed };
}

const PATHS: Array<{ label: string; trigger: RunTrigger }> = [
  { label: 'direct event trigger', trigger: { kind: 'event', key: 'connector:gmail:thread.overdue' } },
  { label: 'Grovekeeper delegation (user dispatch)', trigger: { kind: 'user', key: 'keeper.delegation' } },
  { label: 'schedule', trigger: { kind: 'schedule', key: 'daily.morning' } },
];

describe('§7.2 trust gates — side effects below Graduate', () => {
  for (const path of PATHS) {
    it(`egg via ${path.label}: produces NOTHING (no run, no charge)`, async () => {
      const h = harness();
      const outcome = await executeRun(nibbin('egg'), path.trigger, effectProgram, h.deps);
      expect(outcome).toEqual({ kind: 'not_started', why: 'egg' });
      expect(h.executed).toHaveLength(0);
      expect(h.runs.balance(ACCOUNT)).toBe(100); // not a credit was spent
    });

    it(`student via ${path.label}: drafts, never executes`, async () => {
      const h = harness();
      const outcome = await executeRun(nibbin('student'), path.trigger, effectProgram, h.deps);
      expect(outcome.kind).toBe('awaiting_approval');
      expect(h.executed).toHaveLength(0);
    });

    it(`senior (novel pattern) via ${path.label}: drafts and flags novelty`, async () => {
      const h = harness();
      h.grants.grant('nib-1', CONN, 'email.draft'); // granted but NOT routine
      const outcome = await executeRun(nibbin('senior'), path.trigger, effectProgram, h.deps);
      expect(outcome.kind).toBe('awaiting_approval');
      expect(h.executed).toHaveLength(0);
      const run = [...h.runs.runs.values()][0];
      const draftStep = run.steps.find((s) => s.kind === 'draft');
      expect(draftStep?.payload?.gate).toBe('novelty');
    });
  }

  it('senior with a routine pattern but NO write grant: still drafts (C8 structural)', async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) h.routines.approve('nib-1', 'email.draft:overdue-followup');
    const outcome = await executeRun(nibbin('senior'), PATHS[0].trigger, effectProgram, h.deps);
    expect(outcome.kind).toBe('awaiting_approval');
    expect(h.executed).toHaveLength(0);
  });

  it('graduate with NO write grant: still drafts (autonomy never outruns access)', async () => {
    const h = harness();
    const outcome = await executeRun(nibbin('grad'), PATHS[0].trigger, effectProgram, h.deps);
    expect(outcome.kind).toBe('awaiting_approval');
    expect(h.executed).toHaveLength(0);
  });

  it('senior with routine pattern AND grant: executes (earned autonomy, §4.7)', async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) h.routines.approve('nib-1', 'email.draft:overdue-followup');
    h.grants.grant('nib-1', CONN, 'email.draft');
    const outcome = await executeRun(nibbin('senior'), PATHS[0].trigger, effectProgram, h.deps);
    expect(outcome.kind).toBe('executed');
    expect(h.executed).toHaveLength(1);
  });

  it('graduate with grant: executes within spec', async () => {
    const h = harness();
    h.grants.grant('nib-1', CONN, 'email.draft');
    const outcome = await executeRun(nibbin('grad'), PATHS[0].trigger, effectProgram, h.deps);
    expect(outcome.kind).toBe('executed');
  });

  it('presentation drafts never execute, even for a granted graduate', async () => {
    const h = harness();
    h.grants.grant('nib-1', CONN, 'email.read');
    const presentation: ProgramFn = async function* () {
      yield {
        kind: 'draft',
        capability: 'email.read',
        connectionId: CONN,
        patternKey: 'brief:digest',
        title: 'Digest',
        draft: 'Your morning.',
        effectArgs: {},
        presentation: true,
      };
    };
    const outcome = await executeRun(nibbin('grad'), PATHS[0].trigger, presentation, h.deps);
    expect(outcome.kind).toBe('awaiting_approval');
    expect(h.executed).toHaveLength(0);
  });
});
