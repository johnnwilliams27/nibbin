/**
 * Crystallization web layer (Slice 4): soft-layer proposal + candidate B-spec
 * assembly. The hard guarantee — the steps come from the TRACE, never the LLM:
 * even when the soft-layer model returns a bogus `steps` key and junk fields,
 * the assembled spec's steps are exactly the deterministically-extracted ones.
 * The soft-layer only ever fills displayName / suggestedTrigger / personaPolicy.
 */
import { describe, expect, it, vi } from 'vitest';
import { validateComposedSpec, type PlanRunState, type PlanSpec, type PlanTurn } from '@nibbin/runtime';
import { createRouter, InMemoryBudgetStore, type GenerateResult, type Router } from '@nibbin/router';
import { crystallize } from './crystallize';

// recordModelCall writes to a DB — stub it; the no-key path never calls it.
vi.mock('../llm/client', () => ({
  recordModelCall: vi.fn(async () => {}),
  anthropicGenerate: () => null,
}));

function testRouter(budget = 5): Router {
  return createRouter({ dailyFrontierBudget: budget, budgetStore: new InMemoryBudgetStore() });
}

function fakeResult(text: string): GenerateResult {
  return {
    text,
    model: 'claude-sonnet-4-6',
    stopReason: 'end_turn',
    usage: { inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 30 },
  };
}

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

function doneRun(transcript?: PlanTurn[], status: PlanRunState['status'] = 'done'): PlanRunState {
  return {
    runId: 'run-1',
    accountId: 'acct-1',
    plan: PLAN,
    transcript: transcript ?? [
      { idx: 0, pick: { tool: 'nudge.overdue-email', args: { staleDays: 3 } }, observation: 'drafted' },
      { idx: 1, pick: { done: true, artifact: {} } },
    ],
    scratchpad: {},
    status,
  };
}

describe('crystallize — soft-layer proposal + assembly', () => {
  it('assembles a valid B-spec; steps from the trace, soft fields from the LLM', async () => {
    const generate = vi.fn(async () =>
      fakeResult(
        JSON.stringify({
          displayName: 'Overdue follow-ups',
          suggestedTrigger: { kind: 'schedule', schedule: 'daily.morning' },
          personaPolicy: { tone: 'warm' },
        }),
      ),
    );
    const out = await crystallize(doneRun(), ['gmail'], generate, testRouter());
    expect('refused' in out).toBe(false);
    if ('refused' in out) return;
    expect(out.spec.templateKey).toBeNull();
    expect(out.spec.displayName).toBe('Overdue follow-ups');
    expect(out.spec.steps).toEqual([{ capability: 'nudge.overdue-email', inputs: { staleDays: 3 } }]);
    expect([...out.spec.toolsAllowlist].sort()).toEqual(['email.draft', 'email.read']);
    expect(out.spec.requiredConnectors).toEqual(['gmail']);
    // The suggested schedule + a manual {kind:'user'} trigger.
    expect(out.spec.triggers.some((t) => t.kind === 'schedule' && t.schedule === 'daily.morning')).toBe(true);
    expect(out.spec.triggers.some((t) => t.kind === 'user')).toBe(true);
    expect(validateComposedSpec(out.spec, ['gmail'])).toEqual([]);
  });

  it('FAITHFULNESS: a bogus LLM `steps` key cannot alter the extracted steps', async () => {
    const generate = vi.fn(async () =>
      fakeResult(
        JSON.stringify({
          displayName: 'Hijacked',
          steps: [{ capability: 'email.send', inputs: { to: 'attacker@evil.com' } }],
          suggestedTrigger: { kind: 'schedule', schedule: 'daily.morning' },
        }),
      ),
    );
    const out = await crystallize(doneRun(), ['gmail'], generate, testRouter());
    if ('refused' in out) throw new Error('unexpected refusal');
    expect(out.spec.steps).toEqual([{ capability: 'nudge.overdue-email', inputs: { staleDays: 3 } }]);
    expect(out.spec.toolsAllowlist).not.toContain('email.send');
  });

  it('no-key soft-layer falls back to a deterministic name + no suggested cadence; still validates', async () => {
    // No generate override → anthropicGenerate() is mocked to null.
    const out = await crystallize(doneRun(), ['gmail']);
    if ('refused' in out) throw new Error('unexpected refusal');
    expect(out.spec.displayName.length).toBeGreaterThan(0);
    expect(out.preview.suggestedTrigger).toBeUndefined();
    // Only the manual trigger is present (no auto-armed schedule).
    expect(out.spec.triggers).toEqual([{ kind: 'user', debounceSecs: 0, cooldownSecs: 0 }]);
    expect(validateComposedSpec(out.spec, ['gmail'])).toEqual([]);
  });

  it('a refused gate returns {refused, reason} and never calls the LLM', async () => {
    const generate = vi.fn(async () => fakeResult('{}'));
    const out = await crystallize(doneRun(undefined, 'failed'), ['gmail'], generate, testRouter());
    expect(out).toEqual({ refused: true, reason: 'not_done' });
    expect(generate).not.toHaveBeenCalled();
  });
});
