/**
 * The M6.5 model seam: compose steps with prompts go through the runner's
 * ModelDrafter — pre-call token clamping, quarantined re-entry, honest
 * fallback, ceilings enforced before AND after the call.
 */
import { describe, expect, it } from 'vitest';
import { unwrapQuarantined } from '@nibbin/scan';
import {
  executeRun,
  MemoryEventSink,
  MemoryGrantStore,
  MemoryIdempotencyStore,
  MemoryRoutineStore,
  MemoryRunStore,
  type AgentSpec,
  type ModelDrafter,
  type NibbinRef,
  type ProgramFn,
  type RunnerDeps,
} from '../src/index';
import { quarantine, type QuarantinedContent } from '@nibbin/connectors';

const ACCOUNT = 'acct-m';
const CONN = 'conn-m';
const TRIGGER = { kind: 'user' as const };

function spec(maxTokens = 1000): AgentSpec {
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
    creditProfile: { weightClass: 'standard', ceilings: { maxSteps: 8, maxTokens, maxWallClockMs: 60_000 } },
  };
}

function nib(s: AgentSpec): NibbinRef {
  return { id: 'nib-m', accountId: ACCOUNT, name: 'Echo', stage: 'student', status: 'active', spec: s };
}

function harness(model?: ModelDrafter) {
  const runs = new MemoryRunStore(() => Date.now());
  runs.seedCredits(ACCOUNT, 100);
  const deps: RunnerDeps = {
    runs,
    routines: new MemoryRoutineStore(),
    grants: new MemoryGrantStore(),
    idempotency: new MemoryIdempotencyStore(),
    events: new MemoryEventSink(),
    reader: {
      async read(_c, _cap, path) {
        return quarantine('{"ok":true}', `gmail:test:${path}`);
      },
    },
    effects: { async execute() {} },
    model,
    now: () => Date.now(),
  };
  return { deps, runs };
}

/** A program that asks for one model draft and drafts with whatever came back. */
const promptProgram: ProgramFn = async function* () {
  const fed: QuarantinedContent | undefined = yield {
    kind: 'compose',
    payload: { note: 'asking the model' },
    prompt: { intent: 'draft a reply', context: 'Subject: hello', maxTokens: 300 },
  };
  let body = 'deterministic fallback body';
  if (fed) body = unwrapQuarantined(fed);
  yield {
    kind: 'draft',
    capability: 'email.draft',
    connectionId: CONN,
    patternKey: 'email.draft:test',
    title: 'Test draft',
    draft: body,
    effectArgs: { threadId: 't1' },
  };
};

describe('runner model seam (M6.5)', () => {
  it('feeds the program quarantined model text and records real tokens', async () => {
    const calls: Array<{ intent: string; maxTokens: number }> = [];
    const { deps, runs } = harness({
      async draft(req) {
        calls.push({ intent: req.intent, maxTokens: req.maxTokens });
        return { text: 'a model-written reply', tokens: 250 };
      },
    });
    const out = await executeRun(nib(spec()), TRIGGER, promptProgram, deps);
    expect(out.kind).toBe('awaiting_approval');
    if (out.kind !== 'awaiting_approval') throw new Error('unreachable');
    expect(out.draft.draft).toBe('a model-written reply');
    expect(calls).toEqual([{ intent: 'draft a reply', maxTokens: 300 }]);
    const steps = runs.runs.get(out.runId)?.steps ?? [];
    const compose = steps.find((s) => s.kind === 'compose');
    expect(compose?.tokens).toBe(250);
    expect(compose?.payload).toMatchObject({ model: true });
  });

  it('clamps maxTokens to the run ceiling pre-call', async () => {
    const seen: number[] = [];
    const { deps } = harness({
      async draft(req) {
        seen.push(req.maxTokens);
        return { text: 'short', tokens: 10 };
      },
    });
    await executeRun(nib(spec(120)), TRIGGER, promptProgram, deps); // ceiling 120 < prompt's 300
    expect(seen).toEqual([120]);
  });

  it('kills the run when the model reports more tokens than the ceiling allows', async () => {
    const { deps } = harness({
      async draft() {
        return { text: 'way too much', tokens: 5000 }; // provider overshoot
      },
    });
    const out = await executeRun(nib(spec(100)), TRIGGER, promptProgram, deps);
    expect(out.kind).toBe('killed');
    if (out.kind !== 'killed') throw new Error('unreachable');
    expect(out.reason).toBe('max_tokens');
  });

  it('null from the drafter degrades honestly to the deterministic fallback', async () => {
    const { deps, runs } = harness({
      async draft() {
        return null; // outage / no key / junk output upstream
      },
    });
    const out = await executeRun(nib(spec()), TRIGGER, promptProgram, deps);
    expect(out.kind).toBe('awaiting_approval');
    if (out.kind !== 'awaiting_approval') throw new Error('unreachable');
    expect(out.draft.draft).toBe('deterministic fallback body');
    const compose = (runs.runs.get(out.runId)?.steps ?? []).find((s) => s.kind === 'compose');
    expect(compose?.tokens).toBe(0);
    expect(compose?.payload).toMatchObject({ model: false, fallback: true });
  });

  it('no ModelDrafter wired keeps every compose deterministic (v0 behavior)', async () => {
    const { deps } = harness(undefined);
    const out = await executeRun(nib(spec()), TRIGGER, promptProgram, deps);
    expect(out.kind).toBe('awaiting_approval');
    if (out.kind !== 'awaiting_approval') throw new Error('unreachable');
    expect(out.draft.draft).toBe('deterministic fallback body');
  });
});
