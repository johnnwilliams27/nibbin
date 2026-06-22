/**
 * §7.2 trust-gate suite: attempt side effects at every action level and stage
 * via every path (direct event trigger, Grovekeeper delegation, schedule).
 *
 * CONVERTED (Task 2): actionLevel is the sole execution gate.
 * - observe → no output (kill:observe)
 * - draft   → always drafts (regardless of stage)
 * - send    → always executes (regardless of stage)
 *
 * The hasGrant / routineApprovals checks are no longer in the gate path.
 * They remain in RunnerDeps for other callers but are not tested here as
 * gate conditions. Tests that previously relied on grant+routine to reach
 * execute now set actionLevel='act' explicitly.
 */
import { describe, expect, it } from 'vitest';
import { quarantine } from '@nibbin/connectors';
import {
  executeRun,
  promotionCheck,
  stakesOf,
  MemoryEventSink,
  MemoryGrantStore,
  MemoryIdempotencyStore,
  MemoryRoutineStore,
  MemoryRunStore,
  type AgentSpec,
  type CurriculumConfig,
  type Decision,
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
    toolsAllowlist: ['email.read', 'email.send'],
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
  return { id: 'nib-1', accountId: ACCOUNT, name: 'Echo', stage, stageChangedAt: 0, status: 'active', spec: testSpec() };
}

/** A program that proposes one real side effect. */
const effectProgram: ProgramFn = async function* () {
  yield {
    kind: 'draft',
    capability: 'email.send',
    connectionId: CONN,
    patternKey: 'email.send:overdue-followup',
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

function harness(credits = 100, actionLevel: 'observe' | 'draft' | 'act' = 'draft'): Harness {
  const runs = new MemoryRunStore(() => Date.now());
  runs.seedCredits(ACCOUNT, credits);
  // Seed the nibbin action level so getNibbin() returns the right value.
  runs.nibbinState('nib-1').actionLevel = actionLevel;
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
        // Skip the native-draft mirror (createDraft at draft level, nativeDraft:true)
        // — `executed` tracks real SENDS / side effects, not native-draft creation.
        if (req.args.nativeDraft === true) return undefined;
        executed.push({ capability: req.capability });
        return undefined;
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

describe('§7.2 trust gates — action level controls draft-vs-execute', () => {
  // CONVERTED (Task 2): action level (not stage/grants/routines) is the sole gate.

  for (const path of PATHS) {
    it(`egg + draft via ${path.label}: DRAFTS (egg admission fence removed — action_level is the sole gate)`, async () => {
      // FIX 4: the egg run-admission fence is removed. An Egg now admits and is
      // governed solely by action_level. egg + draft (default) → drafts.
      const h = harness(100, 'draft');
      const outcome = await executeRun(nibbin('egg'), path.trigger, effectProgram, h.deps);
      expect(outcome.kind).toBe('awaiting_approval');
      expect(h.executed).toHaveLength(0); // no SEND fired (native-draft mirror excluded)
    });

    it(`egg + send via ${path.label}: EXECUTES (action_level is the sole gate, stage advisory)`, async () => {
      const h = harness(100, 'act');
      const outcome = await executeRun(nibbin('egg'), path.trigger, effectProgram, h.deps);
      expect(outcome.kind).toBe('executed');
      expect(h.executed).toHaveLength(1);
    });

    it(`egg + observe via ${path.label}: produces NOTHING (kill:observe)`, async () => {
      const h = harness(100, 'observe');
      const outcome = await executeRun(nibbin('egg'), path.trigger, effectProgram, h.deps);
      expect(outcome.kind).toBe('killed');
      expect((outcome as { reason: string }).reason).toBe('observe');
      expect(h.executed).toHaveLength(0);
    });

    it(`student with actionLevel=draft via ${path.label}: drafts, never executes`, async () => {
      // CONVERTED: was "student via path: drafts, never executes" (stage gate).
      // Now: actionLevel=draft (default) causes draft at any stage.
      const h = harness(100, 'draft');
      const outcome = await executeRun(nibbin('student'), path.trigger, effectProgram, h.deps);
      expect(outcome.kind).toBe('awaiting_approval');
      expect(h.executed).toHaveLength(0);
    });

    it(`senior with actionLevel=draft via ${path.label}: drafts and gate reason is 'level'`, async () => {
      // CONVERTED: was "senior (novel pattern) via path: drafts and flags novelty".
      // NEW: gate reason is 'level' (not 'novelty') — actionLevel=draft is the gate.
      const h = harness(100, 'draft');
      const outcome = await executeRun(nibbin('senior'), path.trigger, effectProgram, h.deps);
      expect(outcome.kind).toBe('awaiting_approval');
      expect(h.executed).toHaveLength(0);
      const run = [...h.runs.runs.values()][0];
      const draftStep = run.steps.find((s) => s.kind === 'draft');
      expect(draftStep?.payload?.gate).toBe('level');
    });
  }

  it('actionLevel=draft always drafts regardless of routine approvals (routines no longer gate)', async () => {
    // CONVERTED: was "senior with routine pattern but NO write grant: still drafts".
    // NEW: routineApprovals not in gate — actionLevel=draft drafts at any count.
    const h = harness(100, 'draft');
    for (let i = 0; i < 5; i++) h.routines.approve('nib-1', 'email.draft:overdue-followup');
    const outcome = await executeRun(nibbin('senior'), PATHS[0].trigger, effectProgram, h.deps);
    expect(outcome.kind).toBe('awaiting_approval');
    expect(h.executed).toHaveLength(0);
  });

  it('graduate with actionLevel=draft: drafts (actionLevel beats grade)', async () => {
    // CONVERTED: was "graduate with NO write grant: still drafts (autonomy never outruns access)".
    // NEW: actionLevel=draft overrides grade — grants are not in the gate.
    const h = harness(100, 'draft');
    const outcome = await executeRun(nibbin('grad'), PATHS[0].trigger, effectProgram, h.deps);
    expect(outcome.kind).toBe('awaiting_approval');
    expect(h.executed).toHaveLength(0);
  });

  it('student with actionLevel=send: executes (grade no longer a barrier)', async () => {
    // CONVERTED: was "senior with routine pattern AND grant: executes (earned autonomy, §4.7)".
    // NEW: send level executes at ANY grade. Using student to prove grade is irrelevant.
    const h = harness(100, 'act');
    const outcome = await executeRun(nibbin('student'), PATHS[0].trigger, effectProgram, h.deps);
    expect(outcome.kind).toBe('executed');
    expect(h.executed).toHaveLength(1);
  });

  it('graduate with actionLevel=send: executes within spec', async () => {
    // CONVERTED: was "graduate with grant: executes within spec".
    // NEW: actionLevel=send is the gate — no grant needed.
    const h = harness(100, 'act');
    const outcome = await executeRun(nibbin('grad'), PATHS[0].trigger, effectProgram, h.deps);
    expect(outcome.kind).toBe('executed');
  });

  it('presentation drafts never execute, even at send level', async () => {
    // UNCHANGED: step.presentation=true is always draft regardless of actionLevel.
    const h = harness(100, 'act');
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

/**
 * Promotion gate v2 — strictly ADDITIVE R3 severity + R1 coverage. Every case
 * proves the new conditions can only REJECT (never promote what the base
 * 95%/25 unweighted gate refused) and that the floors only tighten.
 */
function curriculum(coverageMinPatterns?: number): CurriculumConfig {
  return {
    measures: 'test',
    promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95, coverageMinPatterns },
    routineMinApprovals: 5,
  };
}

/** Build a newest-first decisions array: `approved` count + `rejected` filler to 25. */
function decisions(approved: number, total = 25): Decision[] {
  const arr: Decision[] = [];
  for (let i = 0; i < approved; i++) arr.push('approved');
  for (let i = approved; i < total; i++) arr.push('rejected');
  return arr;
}

describe('§4.7 promotion gate v2 — additive R3 severity + R1 coverage', () => {
  it('base unchanged: 25/25 approved with no opts is eligible', () => {
    expect(promotionCheck(decisions(25), curriculum()).eligible).toBe(true);
  });

  it('base unchanged: 23/25 approved (0.92 < 0.95) is NOT eligible', () => {
    expect(promotionCheck(decisions(23), curriculum()).eligible).toBe(false);
  });

  it('R3 weighted blocks: unweighted 24/25 passes but a single computer_use reject drags weighted <0.95', () => {
    // 24 standard approved + 1 computer_use rejected: unweighted 24/25=0.96 pass,
    // weighted 24/(24+10)=0.71 → fail.
    const ds: Decision[] = [];
    const weights: number[] = [];
    for (let i = 0; i < 24; i++) { ds.push('approved'); weights.push(1); }
    ds.push('rejected'); weights.push(10);
    const out = promotionCheck(ds, curriculum(), { weights });
    expect(out.eligible).toBe(false);
  });

  it('R3 weighted blocks on edited (the common near-miss): unweighted 24/25 passes but one computer_use edit drags weighted <0.95', () => {
    // 24 standard approved + 1 computer_use edited: unweighted 24/25=0.96 pass,
    // weighted 24/(24+10)=0.71 → fail. `edited` drags the weighted ratio just
    // like a rejection — it is NOT approved-unedited.
    const ds: Decision[] = [];
    const weights: number[] = [];
    for (let i = 0; i < 24; i++) { ds.push('approved'); weights.push(1); }
    ds.push('edited'); weights.push(10);
    const out = promotionCheck(ds, curriculum(), { weights });
    expect(out.eligible).toBe(false);
  });

  it('R3 cannot loosen: an unweighted-fail stays NOT eligible even with high-weight successes', () => {
    // 20/25 unweighted (base fails). Make the 20 approved high-weight (10) and the
    // 5 rejects low-weight (1): weighted ratio would be high, but base must still fail.
    const ds: Decision[] = [];
    const weights: number[] = [];
    for (let i = 0; i < 20; i++) { ds.push('approved'); weights.push(10); }
    for (let i = 0; i < 5; i++) { ds.push('rejected'); weights.push(1); }
    const out = promotionCheck(ds, curriculum(), { weights });
    expect(out.eligible).toBe(false);
  });

  it('R1 coverage blocks at senior: base+weighted pass but distinctPatterns=3 is NOT eligible', () => {
    const weights = decisions(25).map(() => 1);
    expect(
      promotionCheck(decisions(25), curriculum(), { weights, distinctPatterns: 3, stage: 'senior' }).eligible,
    ).toBe(false);
  });

  it('R1 coverage at senior: distinctPatterns=4 is eligible', () => {
    const weights = decisions(25).map(() => 1);
    expect(
      promotionCheck(decisions(25), curriculum(), { weights, distinctPatterns: 4, stage: 'senior' }).eligible,
    ).toBe(true);
  });

  it('R1 only at senior: student with distinctPatterns=0 is eligible (coverage not required)', () => {
    const weights = decisions(25).map(() => 1);
    expect(
      promotionCheck(decisions(25), curriculum(), { weights, distinctPatterns: 0, stage: 'student' }).eligible,
    ).toBe(true);
  });

  it('floors only tighten: coverageMinPatterns=2 still requires 4 (Math.max floor)', () => {
    const weights = decisions(25).map(() => 1);
    // distinctPatterns=3 would pass a K=2 curriculum, but the floor forces K=4.
    expect(
      promotionCheck(decisions(25), curriculum(2), { weights, distinctPatterns: 3, stage: 'senior' }).eligible,
    ).toBe(false);
    expect(
      promotionCheck(decisions(25), curriculum(2), { weights, distinctPatterns: 4, stage: 'senior' }).eligible,
    ).toBe(true);
  });
});

/**
 * stakesOf — the TS mirror of the SQL `capability_stakes`. Reads are low (1),
 * destructive is highest (10), everything else (incl. unknown/null) is the
 * consequential default (3). Must agree with capability_stakes byte-for-byte.
 */
describe('stakesOf — per-action side-effect stakes', () => {
  it('reads → 1', () => {
    expect(stakesOf('email.read')).toBe(1);
    expect(stakesOf('calendar.read')).toBe(1);
  });

  it('consequential (draft/send/nudge/unknown) → 3', () => {
    expect(stakesOf('email.draft')).toBe(3);
    expect(stakesOf('email.send')).toBe(3);
    expect(stakesOf('invoice.nudge')).toBe(3);
    expect(stakesOf('foo.bar')).toBe(3);
  });

  it('destructive → 10', () => {
    expect(stakesOf('mail.delete')).toBe(10);
    expect(stakesOf('mail.archive')).toBe(10);
  });

  it('null/undefined → 1', () => {
    expect(stakesOf(null)).toBe(1);
    expect(stakesOf(undefined)).toBe(1);
  });

  it('empty string → 3 (matches SQL: only NULL is the no-tool sentinel)', () => {
    expect(stakesOf('')).toBe(3);
  });
});
