/**
 * interpretSpec runs a declarative `steps[]` THROUGH the real runner + its
 * gates (design §4 proof). This is the load-bearing safety claim: a composed
 * spec is gated identically to a hand-written program — the interpreter only
 * yields steps; the runner enforces allowlist / quarantine / School / grants /
 * idempotency / ceilings.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { quarantine } from '@nibbin/connectors';
import {
  CAPABILITY_REGISTRY,
  executeRun,
  interpretSpec,
  MemoryEventSink,
  MemoryGrantStore,
  MemoryIdempotencyStore,
  MemoryRoutineStore,
  MemoryRunStore,
  PRIMITIVE_IMPLS,
  type AgentSpec,
  type CapabilityStep,
  type ModelDrafter,
  type NibbinRef,
  type ProgramStep,
  type RunnerDeps,
  type RunTrigger,
} from '../src/index';

const ACCOUNT = 'acct-i';
const GMAIL = 'conn-gmail';
const TRIGGER: RunTrigger = { kind: 'user' };
const CONN_MAP = { gmail: GMAIL, stripe: 'conn-stripe', 'google-calendar': 'conn-gcal' };

function spec(steps: CapabilityStep[]): AgentSpec {
  return {
    templateKey: 'echo',
    version: 1,
    displayName: 'Composed',
    toolsAllowlist: ['email.read', 'email.send'],
    requiredConnectors: ['gmail'],
    triggers: [{ kind: 'user', debounceSecs: 0, cooldownSecs: 0 }],
    curriculum: { measures: 'test', promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95 }, routineMinApprovals: 5 },
    creditProfile: { weightClass: 'standard', ceilings: { maxSteps: 20, maxTokens: 5000, maxWallClockMs: 60_000 } },
    steps,
  };
}

function nib(s: AgentSpec, stage: NibbinRef['stage'] = 'student'): NibbinRef {
  return { id: 'nib-i', accountId: ACCOUNT, name: 'Composed', stage, stageChangedAt: 0, status: 'active', spec: s };
}

interface Harness {
  deps: RunnerDeps;
  runs: MemoryRunStore;
  reads: string[];
  executed: Array<{ capability: string }>;
}

function harness(model?: ModelDrafter): Harness {
  const runs = new MemoryRunStore(() => Date.now());
  runs.seedCredits(ACCOUNT, 100);
  const reads: string[] = [];
  const executed: Array<{ capability: string }> = [];
  const deps: RunnerDeps = {
    runs,
    routines: new MemoryRoutineStore(),
    grants: new MemoryGrantStore(),
    idempotency: new MemoryIdempotencyStore(),
    events: new MemoryEventSink(),
    reader: {
      async read(_c, _cap, path) {
        reads.push(path);
        return quarantine('{"messages":[]}', `gmail:test:${path}`);
      },
    },
    effects: {
      async execute(req) {
        // Skip the native-draft mirror (createDraft at draft level) — `executed`
        // tracks real SENDS / side effects, not native-draft creation.
        if (req.args.nativeDraft === true) return undefined;
        executed.push({ capability: req.capability });
        return undefined;
      },
    },
    model,
    now: () => Date.now(),
  };
  return { deps, runs, reads, executed };
}

describe('interpretSpec — runs a declarative steps-spec via the real runner', () => {
  it('a read → generative-draft spec produces awaiting_approval with the model draft', async () => {
    const model: ModelDrafter = {
      async draft() {
        return { text: 'Hi — circling back on your note. Happy to help whenever works.', tokens: 42 };
      },
    };
    const h = harness(model);
    const s = spec([
      { capability: 'email.read', inputs: { path: '/gmail/v1/users/me/messages?q=in:inbox' } },
      {
        capability: 'email.send',
        prompt: { intent: 'Draft a warm follow-up.', context: 'Subject: Project', maxTokens: 200 },
        inputs: { to: 'someone@example.com', subject: 'Re: Project' },
      },
    ]);
    const program = interpretSpec(s, CONN_MAP);
    const outcome = await executeRun(nib(s), TRIGGER, program, h.deps);

    expect(outcome.kind).toBe('awaiting_approval');
    if (outcome.kind !== 'awaiting_approval') throw new Error('expected awaiting_approval');
    // The read ran through the runner (allowlist + quarantine gate).
    expect(h.reads).toEqual(['/gmail/v1/users/me/messages?q=in:inbox']);
    // The draft carries the model text (compose→draft handoff) + the bound args.
    expect(outcome.draft.draft).toContain('circling back');
    // Per-step patternKey: prefix:templateKey#idx (the draft is step index 1).
    expect(outcome.draft.patternKey).toBe('email.send:echo#1');
    expect(outcome.draft.effectArgs).toEqual({ to: 'someone@example.com', subject: 'Re: Project' });
    // It NEVER executed — interpreter yields steps; the runner gated it as a draft.
    expect(h.executed).toHaveLength(0);
  });

  it('with no model wired the draft falls back to empty text, still drafts (never fails over prose)', async () => {
    const h = harness(); // no model
    const s = spec([
      {
        capability: 'email.send',
        prompt: { intent: 'Draft something.', context: 'x' },
        inputs: { to: 'a@b.com' },
      },
    ]);
    const outcome = await executeRun(nib(s), TRIGGER, interpretSpec(s, CONN_MAP), h.deps);
    expect(outcome.kind).toBe('awaiting_approval');
    if (outcome.kind !== 'awaiting_approval') throw new Error('expected awaiting_approval');
    expect(outcome.draft.draft).toBe('');
    expect(h.executed).toHaveLength(0);
  });

  it('the runner gates the read by the allowlist — a capability outside it kills the run', async () => {
    const h = harness();
    // calendar.read is a valid registry id but NOT in this spec's allowlist.
    const s = spec([{ capability: 'calendar.read', inputs: { path: '/calendar/v3/calendars/primary/events' } }]);
    const outcome = await executeRun(nib(s), TRIGGER, interpretSpec(s, CONN_MAP), h.deps);
    expect(outcome.kind).toBe('killed');
    if (outcome.kind !== 'killed') throw new Error('expected killed');
    expect(outcome.reason).toBe('allowlist');
  });

  it('an unknown capability fails the run cleanly (never yields an ungated step)', async () => {
    const h = harness();
    const s = spec([{ capability: 'mail.nope', inputs: {} }]);
    const outcome = await executeRun(nib(s), TRIGGER, interpretSpec(s, CONN_MAP), h.deps);
    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') throw new Error('expected failed');
    expect(outcome.error).toContain('unknown capability');
    expect(h.executed).toHaveLength(0);
  });

  it('a missing connection fails the run cleanly', async () => {
    const h = harness();
    const s = spec([{ capability: 'email.read', inputs: { path: '/gmail/x' } }]);
    const outcome = await executeRun(nib(s), TRIGGER, interpretSpec(s, {}), h.deps);
    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') throw new Error('expected failed');
    expect(outcome.error).toContain('no active gmail connection');
  });

  it('a read step missing inputs.path fails the run cleanly', async () => {
    const h = harness();
    const s = spec([{ capability: 'email.read', inputs: {} }]);
    const outcome = await executeRun(nib(s), TRIGGER, interpretSpec(s, CONN_MAP), h.deps);
    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') throw new Error('expected failed');
    expect(outcome.error).toContain('missing inputs.path');
  });

  it('actionLevel=send executes the composed draft (action level flows through the interpreter)', async () => {
    // CONVERTED (Task 2): was "a granted Graduate executes (earned autonomy flows through)".
    // NEW: actionLevel='act' is the sole gate — grade and grant are irrelevant.
    // Using 'student' stage + no grant to prove neither is required for execution.
    const h = harness();
    h.runs.nibbinState('nib-i').actionLevel = 'act';
    const s = spec([{ capability: 'email.send', inputs: { to: 'a@b.com' } }]);
    const outcome = await executeRun(nib(s, 'student'), TRIGGER, interpretSpec(s, CONN_MAP), h.deps);
    expect(outcome.kind).toBe('executed');
    expect(h.executed).toEqual([{ capability: 'email.send' }]);
  });

  /* ── P2-1: read-path guard (SSRF / traversal) ──────────────────────────── */

  it.each([
    ['absolute URL', 'https://evil.example/steal'],
    ['protocol-relative', '//evil.example/steal'],
    ['scheme inside', '/x?u=http://evil.example'],
    ['traversal', '/gmail/v1/../../admin'],
    ['not slash-rooted', 'gmail/v1/users/me/messages'],
  ])('a read path that is %s fails the run cleanly (does not yield a read)', async (_label, path) => {
    const h = harness();
    const s = spec([{ capability: 'email.read', inputs: { path } }]);
    const outcome = await executeRun(nib(s), TRIGGER, interpretSpec(s, CONN_MAP), h.deps);
    expect(outcome.kind).toBe('failed');
    // No read reached the reader — the guard threw before yielding.
    expect(h.reads).toHaveLength(0);
  });

  it('a safe connector-relative read path is allowed', async () => {
    const h = harness();
    const s = spec([{ capability: 'email.read', inputs: { path: '/gmail/v1/users/me/messages?q=x' } }]);
    await executeRun(nib(s), TRIGGER, interpretSpec(s, CONN_MAP), h.deps);
    expect(h.reads).toEqual(['/gmail/v1/users/me/messages?q=x']);
  });

  /* ── P2-2: effectArgs sanitization (header / MIME injection) ───────────── */

  it('strips CR/LF from effectArgs strings before drafting (no injected header break)', async () => {
    const h = harness();
    const s = spec([
      {
        capability: 'email.send',
        inputs: {
          to: 'victim@example.com\r\nBcc: attacker@evil.example',
          subject: 'Hello\nX-Injected: 1',
          count: 3,
          flag: true,
          meta: { reply: 'line1\r\nline2' },
        },
      },
    ]);
    const outcome = await executeRun(nib(s), TRIGGER, interpretSpec(s, CONN_MAP), h.deps);
    expect(outcome.kind).toBe('awaiting_approval');
    if (outcome.kind !== 'awaiting_approval') throw new Error('expected awaiting_approval');
    const args = outcome.draft.effectArgs;
    expect(args.to).toBe('victim@example.com Bcc: attacker@evil.example');
    expect(args.to).not.toMatch(/[\r\n]/);
    expect(args.subject).toBe('Hello X-Injected: 1');
    // Numbers/booleans untouched; nested strings neutralized one level deep.
    expect(args.count).toBe(3);
    expect(args.flag).toBe(true);
    expect((args.meta as { reply: string }).reply).toBe('line1 line2');
  });

  it('caps an over-long effectArgs string at the header-line length', async () => {
    const h = harness();
    const long = 'a'.repeat(2000);
    const s = spec([{ capability: 'email.send', inputs: { subject: long } }]);
    const outcome = await executeRun(nib(s), TRIGGER, interpretSpec(s, CONN_MAP), h.deps);
    if (outcome.kind !== 'awaiting_approval') throw new Error('expected awaiting_approval');
    expect((outcome.draft.effectArgs.subject as string).length).toBe(998);
  });

  /* ── P2-3: per-step patternKey discriminator ──────────────────────────── */

  it('two distinct draft steps get distinct patternKeys (independent routine identities)', async () => {
    const s = spec([
      { capability: 'email.send', inputs: { to: 'a@b.com' } },
      { capability: 'email.send', inputs: { to: 'c@d.com' } },
    ]);
    const gen = interpretSpec(s, CONN_MAP)({ nibbin: nib(s), trigger: TRIGGER });
    const first = await gen.next();
    const second = await gen.next();
    if (first.done || second.done) throw new Error('expected two draft steps');
    if (first.value.kind !== 'draft' || second.value.kind !== 'draft') {
      throw new Error('expected draft steps');
    }
    expect(first.value.patternKey).toBe('email.send:echo#0');
    expect(second.value.patternKey).toBe('email.send:echo#1');
    expect(first.value.patternKey).not.toBe(second.value.patternKey);
  });

  it('a step-level patternKey overrides the derived per-step key', async () => {
    const s = spec([
      { capability: 'email.send', patternKey: 'email.send:overdue-followup', inputs: { to: 'a@b.com' } },
    ]);
    const gen = interpretSpec(s, CONN_MAP)({ nibbin: nib(s), trigger: TRIGGER });
    const step = await gen.next();
    if (step.done || step.value.kind !== 'draft') throw new Error('expected a draft step');
    expect(step.value.patternKey).toBe('email.send:overdue-followup');
  });

  /* ── FIX 3: STRUCTURAL read↔presentation invariant ─────────────────────────
   * A read-sideEffect primitive may only yield a draft step as a PRESENTATION.
   * A non-presentation draft from a read-classified capability would reach the
   * School gate as an EXECUTABLE draft (promoting a read into an autonomous
   * write). The interpreter rejects it structurally, not by convention. We
   * register a synthetic read-primitive whose yielded draft's presentation flag
   * is the only variable. */

  const MOCK_READ_PRIM = 'mock.read-prim';

  /** Register a synthetic read-sideEffect primitive that yields a single draft
   *  step with the given presentation flag, then clean up after the test. */
  function registerMockReadPrimitive(presentation: boolean): void {
    CAPABILITY_REGISTRY[MOCK_READ_PRIM] = {
      id: MOCK_READ_PRIM,
      resource: 'email',
      verb: 'mock',
      sideEffect: 'read',
      requiredConnector: 'gmail',
      kind: 'primitive',
      inputSchema: {},
      effectiveTools: ['email.read'],
    };
    PRIMITIVE_IMPLS[MOCK_READ_PRIM] = (_inputs, connMap) =>
      async function* (): AsyncGenerator<ProgramStep, void, unknown> {
        const gmail = connMap.gmail;
        if (!gmail) throw new Error('no active gmail connection');
        yield {
          kind: 'draft',
          capability: 'email.read',
          connectionId: gmail,
          patternKey: 'mock:read',
          presentation,
          title: 'mock',
          draft: 'mock body',
          effectArgs: {},
        };
      };
  }

  afterEach(() => {
    delete CAPABILITY_REGISTRY[MOCK_READ_PRIM];
    delete PRIMITIVE_IMPLS[MOCK_READ_PRIM];
  });

  it('rejects a read-primitive that yields a NON-presentation side effect (run fails cleanly)', async () => {
    registerMockReadPrimitive(false);
    const h = harness();
    const s = spec([{ capability: MOCK_READ_PRIM, inputs: {} }]);
    const outcome = await executeRun(nib(s), TRIGGER, interpretSpec(s, CONN_MAP), h.deps);
    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') throw new Error('expected failed');
    expect(outcome.error).toContain('non-presentation side effect');
    // It never reached the gate as an executable draft.
    expect(h.executed).toHaveLength(0);
  });

  it('allows a read-primitive that yields a PRESENTATION side effect (drafts, never executes)', async () => {
    registerMockReadPrimitive(true);
    const h = harness();
    const s = spec([{ capability: MOCK_READ_PRIM, inputs: {} }]);
    const outcome = await executeRun(nib(s), TRIGGER, interpretSpec(s, CONN_MAP), h.deps);
    expect(outcome.kind).toBe('awaiting_approval');
    if (outcome.kind !== 'awaiting_approval') throw new Error('expected awaiting_approval');
    expect(outcome.draft.presentation).toBe(true);
    expect(h.executed).toHaveLength(0);
  });
});
