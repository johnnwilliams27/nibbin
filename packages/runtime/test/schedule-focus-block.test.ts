/**
 * Task 3 — `schedule.focus-block` primitive end-to-end proof.
 *
 * Tests the complete action-level matrix via real `executeRun` + the primitive
 * unit behaviour + `validateComposedSpec` structural check.
 *
 * Fixed `NOW_MS` so all ISO dateTime strings are deterministic.
 */
import { describe, expect, it } from 'vitest';
import { quarantine } from '@nibbin/connectors';
import {
  executeRun,
  validateComposedSpec,
  MemoryEventSink,
  MemoryGrantStore,
  MemoryIdempotencyStore,
  MemoryRoutineStore,
  MemoryRunStore,
  scheduleFocusBlock,
  type AgentSpec,
  type NibbinRef,
  type ProgramFn,
  type RunnerDeps,
} from '../src/index';

// ── Fixed clock so dateTime strings are deterministic ───────────────────────
// 2024-01-08T00:00:00Z = Monday.  offset 0 = 2024-01-08 (Mon), …
// We put the overloaded day at offset 0 (Monday) in the reader.
const NOW_MS = 1_704_672_000_000; // 2024-01-08T00:00:00Z (Monday)

const ACCOUNT = 'acct-fb';
const GCAL_CONN = 'gcal-conn-1';
const TRIGGER = { kind: 'user' as const };

// ── Spec + NibbinRef builders ────────────────────────────────────────────────
const CURRICULUM = {
  measures: 'focus blocks drafted',
  promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95 },
  routineMinApprovals: 5,
};
const CREDIT = {
  weightClass: 'standard' as const,
  ceilings: { maxSteps: 120, maxTokens: 12_000, maxWallClockMs: 60_000 },
};

function focusBlockSpec(over: Partial<AgentSpec> = {}): AgentSpec {
  return {
    templateKey: 'focus-block',
    version: 1,
    displayName: 'Focus block scheduler',
    toolsAllowlist: ['calendar.read', 'calendar.event-create'],
    requiredConnectors: ['google-calendar'],
    triggers: [{ kind: 'user' as const }],
    curriculum: CURRICULUM,
    creditProfile: CREDIT,
    steps: [{ capability: 'schedule.focus-block', inputs: { withinDays: 7, minMeetings: 4 } }],
    ...over,
  };
}

function focusNib(actionLevel: 'observe' | 'draft' | 'send'): { h: ReturnType<typeof harness>; nibRef: NibbinRef } {
  const h = harness();
  h.runs.nibbinState('nib-fb').actionLevel = actionLevel;
  const nibRef: NibbinRef = {
    id: 'nib-fb',
    accountId: ACCOUNT,
    name: 'Focus block',
    stage: 'student',
    stageChangedAt: 0,
    status: 'active',
    spec: focusBlockSpec(),
  };
  return { h, nibRef };
}

// ── Reader helpers ───────────────────────────────────────────────────────────
/**
 * Returns a reader that serves a synthetic calendar with 4 events on
 * 2024-01-08 (Monday, offset 0 from NOW_MS) — enough to trigger the
 * "overloaded" threshold at minMeetings=4.
 */
function overloadedCalReader() {
  return {
    async read(_c: string, _cap: string, _path: string) {
      const events = [
        { id: 'e1', status: 'confirmed', start: { dateTime: '2024-01-08T09:00:00Z' } },
        { id: 'e2', status: 'confirmed', start: { dateTime: '2024-01-08T10:00:00Z' } },
        { id: 'e3', status: 'confirmed', start: { dateTime: '2024-01-08T11:00:00Z' } },
        { id: 'e4', status: 'confirmed', start: { dateTime: '2024-01-08T14:00:00Z' } },
      ];
      return quarantine(JSON.stringify({ items: events }), 'gcal:events:test');
    },
  };
}

/**
 * Returns a reader that serves an empty calendar — no overloaded day.
 */
function emptyCalReader() {
  return {
    async read(_c: string, _cap: string, _path: string) {
      return quarantine(JSON.stringify({ items: [] }), 'gcal:events:empty');
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
    reader: reader ?? overloadedCalReader(),
    effects: { async execute() {} },
    now: () => NOW_MS,
  };
  return { deps, runs };
}

// ── Program factory (the primitive as a ProgramFn) ───────────────────────────
function focusBlockProgram(opts: { withinDays?: number; minMeetings?: number } = {}): ProgramFn {
  return scheduleFocusBlock(
    { withinDays: opts.withinDays ?? 7, minMeetings: opts.minMeetings ?? 4 },
    { 'google-calendar': GCAL_CONN },
    NOW_MS,
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Primitive unit tests (direct generator invocation)
// ════════════════════════════════════════════════════════════════════════════
describe('schedule.focus-block — primitive unit', () => {
  it('throws politely when google-calendar connection is missing', async () => {
    const fn = scheduleFocusBlock({}, {}, NOW_MS);
    const gen = fn({ nibbin: { id: 'n', accountId: ACCOUNT, name: 'x', stage: 'student', stageChangedAt: 0, status: 'active', spec: focusBlockSpec() }, trigger: TRIGGER });
    await expect(gen.next()).rejects.toThrow('no active google-calendar connection');
  });

  it('with an overloaded Monday: emits calendar.read then a calendar.event-create draft with well-formed effectArgs.event', async () => {
    const fn = scheduleFocusBlock({ withinDays: 7, minMeetings: 4 }, { 'google-calendar': GCAL_CONN }, NOW_MS);
    const gen = fn({ nibbin: { id: 'n', accountId: ACCOUNT, name: 'x', stage: 'student', stageChangedAt: 0, status: 'active', spec: focusBlockSpec() }, trigger: TRIGGER });

    // Step 1: the read yield
    const readResult = await gen.next();
    expect(readResult.done).toBe(false);
    const readStep = readResult.value as { kind: string; capability: string; connectionId: string; path: string };
    expect(readStep.kind).toBe('read');
    expect(readStep.capability).toBe('calendar.read');
    expect(readStep.connectionId).toBe(GCAL_CONN);

    // Feed back the overloaded calendar payload
    const calPayload = quarantine(
      JSON.stringify({
        items: [
          { id: 'e1', status: 'confirmed', start: { dateTime: '2024-01-08T09:00:00Z' } },
          { id: 'e2', status: 'confirmed', start: { dateTime: '2024-01-08T10:00:00Z' } },
          { id: 'e3', status: 'confirmed', start: { dateTime: '2024-01-08T11:00:00Z' } },
          { id: 'e4', status: 'confirmed', start: { dateTime: '2024-01-08T14:00:00Z' } },
        ],
      }),
      'gcal:events:unit',
    );

    // Step 2: draft yield
    const draftResult = await gen.next(calPayload);
    expect(draftResult.done).toBe(false);
    const draft = draftResult.value as {
      kind: string;
      capability: string;
      connectionId: string;
      patternKey: string;
      effectArgs: { event: { summary: string; start: { dateTime: string }; end: { dateTime: string } } };
    };
    expect(draft.kind).toBe('draft');
    expect(draft.capability).toBe('calendar.event-create');
    expect(draft.connectionId).toBe(GCAL_CONN);
    expect(draft.patternKey).toBe('calendar.event-create:focus-block');

    // effectArgs.event matches what the executor passes to createEvent
    expect(draft.effectArgs.event).toBeDefined();
    expect(draft.effectArgs.event.summary).toBe('Focus block');
    expect(draft.effectArgs.event.start.dateTime).toBe('2024-01-08T08:00:00Z');
    expect(draft.effectArgs.event.end.dateTime).toBe('2024-01-08T09:30:00Z');

    // No reserved keys
    expect((draft.effectArgs as Record<string, unknown>).nativeDraft).toBeUndefined();
    expect((draft.effectArgs as Record<string, unknown>).nativeDraftRef).toBeUndefined();
    expect((draft.effectArgs as Record<string, unknown>).dismiss).toBeUndefined();

    // Done after the draft
    const done = await gen.next();
    expect(done.done).toBe(true);
  });

  it('with no overloaded day: emits only a compose note (no draft)', async () => {
    const fn = scheduleFocusBlock({ withinDays: 7, minMeetings: 4 }, { 'google-calendar': GCAL_CONN }, NOW_MS);
    const gen = fn({ nibbin: { id: 'n', accountId: ACCOUNT, name: 'x', stage: 'student', stageChangedAt: 0, status: 'active', spec: focusBlockSpec() }, trigger: TRIGGER });

    // Step 1: read
    const readResult = await gen.next();
    expect(readResult.done).toBe(false);
    expect((readResult.value as { kind: string }).kind).toBe('read');

    // Feed empty calendar
    const emptyPayload = quarantine(JSON.stringify({ items: [] }), 'gcal:events:empty-unit');

    // Step 2: compose note
    const composeResult = await gen.next(emptyPayload);
    expect(composeResult.done).toBe(false);
    const compose = composeResult.value as { kind: string; payload: { note: string } };
    expect(compose.kind).toBe('compose');
    expect(compose.payload.note).toMatch(/no overloaded/);

    // Done
    const done = await gen.next();
    expect(done.done).toBe(true);
  });

  it('skips cancelled events when counting meetings', async () => {
    const fn = scheduleFocusBlock({ withinDays: 7, minMeetings: 4 }, { 'google-calendar': GCAL_CONN }, NOW_MS);
    const gen = fn({ nibbin: { id: 'n', accountId: ACCOUNT, name: 'x', stage: 'student', stageChangedAt: 0, status: 'active', spec: focusBlockSpec() }, trigger: TRIGGER });

    await gen.next(); // read step

    // 3 confirmed + 2 cancelled → only 3 effective; no overload at minMeetings=4
    const payload = quarantine(
      JSON.stringify({
        items: [
          { id: 'e1', status: 'confirmed', start: { dateTime: '2024-01-08T09:00:00Z' } },
          { id: 'e2', status: 'confirmed', start: { dateTime: '2024-01-08T10:00:00Z' } },
          { id: 'e3', status: 'confirmed', start: { dateTime: '2024-01-08T11:00:00Z' } },
          { id: 'e4', status: 'cancelled', start: { dateTime: '2024-01-08T14:00:00Z' } },
          { id: 'e5', status: 'cancelled', start: { dateTime: '2024-01-08T15:00:00Z' } },
        ],
      }),
      'gcal:events:cancelled-unit',
    );

    const result = await gen.next(payload);
    expect((result.value as { kind: string }).kind).toBe('compose');
  });

  it('skips weekend days when searching for overloaded day', async () => {
    // NOW_MS is Monday 2024-01-08; offset 5 = Saturday 2024-01-13, offset 6 = Sunday 2024-01-14.
    // Load meetings only on Saturday/Sunday — should find NO weekday overload.
    const fn = scheduleFocusBlock({ withinDays: 7, minMeetings: 4 }, { 'google-calendar': GCAL_CONN }, NOW_MS);
    const gen = fn({ nibbin: { id: 'n', accountId: ACCOUNT, name: 'x', stage: 'student', stageChangedAt: 0, status: 'active', spec: focusBlockSpec() }, trigger: TRIGGER });

    await gen.next(); // read

    const satDate = '2024-01-13';
    const payload = quarantine(
      JSON.stringify({
        items: [
          { id: 's1', status: 'confirmed', start: { dateTime: `${satDate}T09:00:00Z` } },
          { id: 's2', status: 'confirmed', start: { dateTime: `${satDate}T10:00:00Z` } },
          { id: 's3', status: 'confirmed', start: { dateTime: `${satDate}T11:00:00Z` } },
          { id: 's4', status: 'confirmed', start: { dateTime: `${satDate}T14:00:00Z` } },
        ],
      }),
      'gcal:events:weekend-unit',
    );

    const result = await gen.next(payload);
    expect((result.value as { kind: string }).kind).toBe('compose'); // no weekday overload → compose note
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Action-level matrix via executeRun
// ════════════════════════════════════════════════════════════════════════════
describe('schedule.focus-block — action-level matrix (C8 proof for calendar write)', () => {
  it('observe → killed:observe — no draft recorded, no effect', async () => {
    const { h, nibRef } = focusNib('observe');
    h.deps.reader = overloadedCalReader();
    let executions = 0;
    h.deps.effects = { async execute() { executions += 1; } };

    const outcome = await executeRun(nibRef, TRIGGER, focusBlockProgram(), h.deps);
    expect(outcome.kind).toBe('killed');
    expect((outcome as { reason: string }).reason).toBe('observe');
    expect(executions).toBe(0);

    // Verify zero draft rows
    const runId = (outcome as { runId: string }).runId;
    const draftRows = h.runs.getSteps(runId).filter((s) => s.kind === 'draft');
    expect(draftRows).toHaveLength(0);
  });

  it('draft → awaiting_approval — Nibbin draft step recorded with calendar.event-create; NO native draft; executor NOT called', async () => {
    const { h, nibRef } = focusNib('draft');
    h.deps.reader = overloadedCalReader();
    let executions = 0;
    h.deps.effects = { async execute() { executions += 1; } };

    const outcome = await executeRun(nibRef, TRIGGER, focusBlockProgram(), h.deps);
    expect(outcome.kind).toBe('awaiting_approval');
    expect(executions).toBe(0); // calendar.event-create is nativeDraft:false → NO executor call at draft

    const runId = (outcome as { runId: string }).runId;
    const draftRows = h.runs.getSteps(runId).filter((s) => s.kind === 'draft');
    expect(draftRows).toHaveLength(1);
    // The capability is stored as StepRecord.tool (not payload.capability)
    expect(draftRows[0].tool).toBe('calendar.event-create');
    // Ensure no nativeDraftRef was set (nativeDraft:false on the descriptor)
    expect(draftRows[0].payload?.nativeDraftRef).toBeUndefined();
  });

  it('send → executed — effects executor called exactly once with the event body', async () => {
    const { h, nibRef } = focusNib('send');
    h.deps.reader = overloadedCalReader();
    const effectCalls: Array<Record<string, unknown>> = [];
    h.deps.effects = {
      async execute(req) {
        if (req.capability === 'calendar.event-create') effectCalls.push(req.args);
      },
    };

    const outcome = await executeRun(nibRef, TRIGGER, focusBlockProgram(), h.deps);
    expect(outcome.kind).toBe('executed');
    // Exactly one executor call for the event-create
    expect(effectCalls).toHaveLength(1);
    // The executor receives `event` in args (as engine.ts:369 reads `args.args.event`)
    const eventArg = (effectCalls[0] as { event?: { summary?: string } }).event;
    expect(eventArg).toBeDefined();
    expect(eventArg?.summary).toBe('Focus block');
  });

  it('send with replayed trigger → idempotency holds — effect fires exactly once', async () => {
    // Share the same idempotency store across two executeRun calls with the same trigger.
    const { h, nibRef } = focusNib('send');
    h.deps.reader = overloadedCalReader();
    let executions = 0;
    h.deps.effects = {
      async execute(req) { if (req.capability === 'calendar.event-create') executions += 1; },
    };

    const sameEvent = { kind: 'event' as const, key: 'gcal:focus', dedupeKey: 'focus-evt-1' };
    const first = await executeRun(nibRef, sameEvent, focusBlockProgram(), h.deps);
    expect(first.kind).toBe('executed');
    expect(executions).toBe(1);

    // Replay with zero debounce
    const replaySpec = focusBlockSpec({
      triggers: [{ kind: 'event' as const, source: 'connector:google-calendar:focus', debounceSecs: 0, cooldownSecs: 0 }],
    });
    const again = await executeRun({ ...nibRef, spec: replaySpec }, sameEvent, focusBlockProgram(), h.deps);
    expect(again.kind).toBe('executed');
    expect(executions).toBe(1); // idempotency wall held
  });

  it('no overloaded day → completes with no draft step even at send level', async () => {
    const { h, nibRef } = focusNib('send');
    h.deps.reader = emptyCalReader();
    let executions = 0;
    h.deps.effects = { async execute() { executions += 1; } };

    const outcome = await executeRun(nibRef, TRIGGER, focusBlockProgram(), h.deps);
    expect(outcome.kind).toBe('completed'); // compose note → no draft → completed
    expect(executions).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. validateComposedSpec — structural check
// ════════════════════════════════════════════════════════════════════════════
describe('schedule.focus-block — validateComposedSpec', () => {
  const GRANTED = ['google-calendar'];

  it('a composed spec wiring schedule.focus-block validates (primitive, passes composed rule)', () => {
    const s = focusBlockSpec();
    const problems = validateComposedSpec(s, GRANTED);
    expect(problems).toEqual([]);
  });

  it('rejects when google-calendar is not in accountConnections', () => {
    const s = focusBlockSpec();
    const problems = validateComposedSpec(s, []);
    expect(problems.some((p) => /google-calendar/.test(p))).toBe(true);
  });

  it('rejects a raw (non-primitive) calendar.event-create step in a composed spec', () => {
    // A composed spec must use the PRIMITIVE id, not the raw atomic capability.
    // Using 'calendar.event-create' directly as a step is not kind:'primitive'
    // → validateComposedSpec must reject it.
    const s: AgentSpec = {
      ...focusBlockSpec(),
      steps: [{ capability: 'calendar.event-create', inputs: {} }],
    };
    const problems = validateComposedSpec(s, GRANTED);
    // The validator rejects raw write/draft steps that are not kind:'primitive'
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => /primitive/.test(p) || /write/.test(p))).toBe(true);
  });

  it('schedule.focus-block is described as kind:primitive in the registry', async () => {
    // Import capability directly to verify descriptor shape
    const { capability } = await import('../src/index');
    const desc = capability('schedule.focus-block');
    expect(desc).toBeDefined();
    expect(desc?.kind).toBe('primitive');
    expect(desc?.sideEffect).toBe('write');
    expect(desc?.requiredConnector).toBe('google-calendar');
    expect(desc?.effectiveTools).toContain('calendar.read');
    expect(desc?.effectiveTools).toContain('calendar.event-create');
  });
});
