/**
 * interpretSpec runs a declarative `steps[]` THROUGH the real runner + its
 * gates (design §4 proof). This is the load-bearing safety claim: a composed
 * spec is gated identically to a hand-written program — the interpreter only
 * yields steps; the runner enforces allowlist / quarantine / School / grants /
 * idempotency / ceilings.
 */
import { describe, expect, it } from 'vitest';
import { quarantine, type QuarantinedContent } from '@nibbin/connectors';
import {
  executeRun,
  interpretSpec,
  MemoryEventSink,
  MemoryGrantStore,
  MemoryIdempotencyStore,
  MemoryRoutineStore,
  MemoryRunStore,
  type AgentSpec,
  type CapabilityStep,
  type ModelDrafter,
  type NibbinRef,
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
    toolsAllowlist: ['email.read', 'email.draft'],
    requiredConnectors: ['gmail'],
    triggers: [{ kind: 'user', debounceSecs: 0, cooldownSecs: 0 }],
    curriculum: { measures: 'test', promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95 }, routineMinApprovals: 5 },
    creditProfile: { weightClass: 'standard', ceilings: { maxSteps: 20, maxTokens: 5000, maxWallClockMs: 60_000 } },
    steps,
  };
}

function nib(s: AgentSpec, stage: NibbinRef['stage'] = 'student'): NibbinRef {
  return { id: 'nib-i', accountId: ACCOUNT, name: 'Composed', stage, status: 'active', spec: s };
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
        executed.push({ capability: req.capability });
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
        capability: 'email.draft',
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
    expect(outcome.draft.patternKey).toBe('email.draft:echo');
    expect(outcome.draft.effectArgs).toEqual({ to: 'someone@example.com', subject: 'Re: Project' });
    // It NEVER executed — interpreter yields steps; the runner gated it as a draft.
    expect(h.executed).toHaveLength(0);
  });

  it('with no model wired the draft falls back to empty text, still drafts (never fails over prose)', async () => {
    const h = harness(); // no model
    const s = spec([
      {
        capability: 'email.draft',
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

  it('a granted Graduate executes the composed draft (earned autonomy flows through the interpreter)', async () => {
    const h = harness();
    (h.deps.grants as MemoryGrantStore).grant('nib-i', GMAIL, 'email.draft');
    const s = spec([{ capability: 'email.draft', inputs: { to: 'a@b.com' } }]);
    const outcome = await executeRun(nib(s, 'grad'), TRIGGER, interpretSpec(s, CONN_MAP), h.deps);
    expect(outcome.kind).toBe('executed');
    expect(h.executed).toEqual([{ capability: 'email.draft' }]);
  });
});
