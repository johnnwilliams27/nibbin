/**
 * Crystallization Slice 4 — the deterministic extractor + fail-closed gate.
 *
 * The defining property: the executable steps come from the TRACE, never an
 * LLM. crystallizeTranscript walks the transcript and collects connector /
 * primitive picks in order as CapabilitySteps; crystallizabilityGate refuses
 * any run that can't safely recur (non-`done`, read-only/research, a utility in
 * the path, observation-dependent branching, an un-generalizable raw atomic
 * pick, or a spec that fails validateComposedSpec). Pure, unit-testable.
 */
import { describe, expect, it } from 'vitest';
import { crystallizeTranscript, crystallizabilityGate } from '../src/crystallize';
import type { PlanRunState, PlanSpec, PlanTurn } from '../src/types';

const PLAN: PlanSpec = {
  kind: 'plan',
  ephemeral: true,
  goal: 'draft a follow-up for threads gone quiet',
  intendedSteps: ['watch the inbox', 'draft a nudge'],
  toolsAllowlist: ['nudge.overdue-email', 'done'],
  requiredConnectors: ['gmail'],
  weightClass: 'frontier',
  ceilings: { maxSteps: 60, maxTokens: 8000, maxWallClockMs: 60_000, maxIterations: 12 },
};

function runWith(
  transcript: PlanTurn[],
  status: PlanRunState['status'] = 'done',
  plan: PlanSpec = PLAN,
): PlanRunState {
  return {
    runId: 'run-1',
    accountId: 'acct-1',
    plan,
    transcript,
    scratchpad: {},
    status,
  };
}

/** A primitive draft pick + done — the canonical crystallizable shape. */
function primitiveDoneTranscript(): PlanTurn[] {
  return [
    { idx: 0, pick: { tool: 'nudge.overdue-email', args: { staleDays: 3 } }, observation: 'drafted a follow-up' },
    { idx: 1, pick: { done: true, artifact: {} } },
  ];
}

describe('crystallizeTranscript — steps from the trace', () => {
  it('extracts a primitive pick as a CapabilityStep with its args as inputs', () => {
    const out = crystallizeTranscript(runWith(primitiveDoneTranscript()));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.steps).toEqual([{ capability: 'nudge.overdue-email', inputs: { staleDays: 3 } }]);
  });

  it('marks a raw atomic draft pick as ungeneralizable (must ride a primitive)', () => {
    const out = crystallizeTranscript(
      runWith([
        { idx: 0, pick: { tool: 'email.draft', args: { threadId: 'thread-abc' } }, observation: 'drafted' },
        { idx: 1, pick: { done: true, artifact: {} } },
      ]),
    );
    expect(out).toEqual({ ok: false, reason: 'ungeneralizable', detail: expect.any(String) });
  });

  it('marks a utility pick in the path as utility_in_path', () => {
    const out = crystallizeTranscript(
      runWith([
        { idx: 0, pick: { tool: 'web.search', args: { query: 'x' } }, observation: 'results' },
        { idx: 1, pick: { tool: 'nudge.overdue-email', args: {} }, observation: 'drafted' },
        { idx: 2, pick: { done: true, artifact: {} } },
      ]),
    );
    expect(out).toEqual({ ok: false, reason: 'utility_in_path', detail: expect.any(String) });
  });
});

describe('crystallizabilityGate — fail-closed', () => {
  it('accepts a primitive draft → {ok:true, steps}', () => {
    const out = crystallizabilityGate(runWith(primitiveDoneTranscript()), ['gmail']);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.steps).toEqual([{ capability: 'nudge.overdue-email', inputs: { staleDays: 3 } }]);
  });

  it('refuses a non-done run with not_done', () => {
    const out = crystallizabilityGate(runWith(primitiveDoneTranscript(), 'failed'), ['gmail']);
    expect(out).toEqual({ ok: false, reason: 'not_done', detail: expect.any(String) });
  });

  it('refuses a read-only run (no connector action) with no_action', () => {
    // email.read only — no draft/effect produced. A pure research run.
    const out = crystallizabilityGate(
      runWith([
        { idx: 0, pick: { tool: 'email.read', args: { path: '/messages?q=is:unread' } }, observation: 'read 3' },
        { idx: 1, pick: { done: true, artifact: {} } },
      ]),
      ['gmail'],
    );
    expect(out).toEqual({ ok: false, reason: 'no_action', detail: expect.any(String) });
  });

  it('refuses a run with a utility in the load-bearing path with utility_in_path', () => {
    const out = crystallizabilityGate(
      runWith([
        { idx: 0, pick: { tool: 'web.search', args: { query: 'x' } }, observation: 'results' },
        { idx: 1, pick: { tool: 'nudge.overdue-email', args: {} }, observation: 'drafted' },
        { idx: 2, pick: { done: true, artifact: {} } },
      ]),
      ['gmail'],
    );
    expect(out).toEqual({ ok: false, reason: 'utility_in_path', detail: expect.any(String) });
  });

  it('refuses an ask_human run with utility_in_path (needed live judgment)', () => {
    const out = crystallizabilityGate(
      runWith([
        { idx: 0, pick: { ask_human: true, kind: 'decision', question: 'which thread?' }, observation: 'human: that one' },
        { idx: 1, pick: { tool: 'nudge.overdue-email', args: {} }, observation: 'drafted' },
        { idx: 2, pick: { done: true, artifact: {} } },
      ]),
      ['gmail'],
    );
    expect(out).toEqual({ ok: false, reason: 'utility_in_path', detail: expect.any(String) });
  });

  it('refuses a branching run (atomic read path derived from a prior observation) with branching', () => {
    // An atomic read whose path embeds a concrete id derived from a prior step's
    // observation — the linear extract can't reproduce that.
    const readPlan: PlanSpec = {
      ...PLAN,
      toolsAllowlist: ['email.read', 'nudge.overdue-email', 'done'],
    };
    const out = crystallizabilityGate(
      runWith(
        [
          { idx: 0, pick: { tool: 'email.read', args: { path: '/messages?q=is:unread' } }, observation: 'found thread t-1' },
          { idx: 1, pick: { tool: 'email.read', args: { path: '/messages/t-1' } }, observation: 'read t-1' },
          { idx: 2, pick: { tool: 'nudge.overdue-email', args: {} }, observation: 'drafted' },
          { idx: 3, pick: { done: true, artifact: {} } },
        ],
        'done',
        readPlan,
      ),
      ['gmail'],
    );
    expect(out).toEqual({ ok: false, reason: 'branching', detail: expect.any(String) });
  });

  it('refuses an un-generalizable raw atomic draft with ungeneralizable', () => {
    const out = crystallizabilityGate(
      runWith([
        { idx: 0, pick: { tool: 'email.draft', args: { threadId: 'thread-abc' } }, observation: 'drafted' },
        { idx: 1, pick: { done: true, artifact: {} } },
      ]),
      ['gmail'],
    );
    expect(out).toEqual({ ok: false, reason: 'ungeneralizable', detail: expect.any(String) });
  });

  it('refuses when the extracted spec fails validateComposedSpec (connector not granted) with invalid_spec', () => {
    // nudge.overdue-email needs gmail; the account has no connector granted.
    const out = crystallizabilityGate(runWith(primitiveDoneTranscript()), []);
    expect(out).toEqual({ ok: false, reason: 'invalid_spec', detail: expect.any(String) });
  });
});
