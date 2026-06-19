/**
 * Plan synthesis (Slice 3a, design §2.1): an LLM proposes a plan in strict
 * JSON; whatever it returns, the assembled PlanSpec is run through
 * validatePlanSpec fail-closed. No model key → a clean {error} (no deterministic
 * fallback — a reasoning loop needs a model). An off-surface tool is dropped or
 * the plan is rejected — never an invalid plan.
 */
import { describe, expect, it, vi } from 'vitest';
import { validatePlanSpec } from '@nibbin/runtime';
import { createRouter, InMemoryBudgetStore, type Generate, type GenerateResult, type Router } from '@nibbin/router';
import { planForIntent } from './plan';

function testRouter(budget = 5): Router {
  return createRouter({ dailyFrontierBudget: budget, budgetStore: new InMemoryBudgetStore() });
}

vi.mock('../llm/client', () => ({
  recordModelCall: vi.fn(async () => {}),
  anthropicGenerate: () => null,
}));

// web-search is off in these tests unless the env flag is set.
vi.mock('./websearch', () => ({ webSearchEnabled: () => false }));

const GMAIL_GCAL_STRIPE = ['gmail', 'google-calendar', 'stripe'];

function fakeGenerate(json: unknown): Generate {
  return async (): Promise<GenerateResult> => ({
    model: 'claude-sonnet-4-6',
    text: JSON.stringify(json),
    stopReason: 'end_turn',
    usage: { inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 20 },
  });
}

describe('planForIntent', () => {
  it('with a valid plan JSON + connectors granted → {plan, preview}, plan passes validatePlanSpec', async () => {
    const gen = fakeGenerate({
      goal: 'tell me what needs attention today',
      intendedSteps: ['read the inbox', 'check the calendar', 'summarize'],
      toolsAllowlist: ['email.read', 'calendar.read', 'memory.retrieve', 'done'],
      requiredConnectors: ['gmail', 'google-calendar'],
    });
    const result = await planForIntent(
      'acct-1',
      'user-1',
      'tell me what needs attention today',
      GMAIL_GCAL_STRIPE,
      gen,
      testRouter(),
    );
    expect('plan' in result).toBe(true);
    if ('plan' in result) {
      expect(result.plan.weightClass).toBe('frontier');
      expect(validatePlanSpec(result.plan, GMAIL_GCAL_STRIPE, { webSearchEnabled: false })).toEqual([]);
      // every allowlist entry is a granted connector cap or a utility
      expect(result.plan.toolsAllowlist).toContain('done');
      expect(result.preview.goal).toBeTruthy();
    }
  });

  it('with NO model key → {error:"planning requires a model"} (no throw, no partial plan)', async () => {
    // anthropicGenerate is mocked to null and no override is passed.
    const result = await planForIntent('acct-1', 'user-1', 'do a thing', GMAIL_GCAL_STRIPE);
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toMatch(/planning requires a model/);
  });

  it('drops an off-surface tool the LLM proposes (never an invalid plan)', async () => {
    const gen = fakeGenerate({
      goal: 'help',
      intendedSteps: ['x'],
      // 'totally.bogus' is off-surface; 'web.search' is off (no provider) here.
      toolsAllowlist: ['email.read', 'totally.bogus', 'web.search', 'done'],
      requiredConnectors: ['gmail'],
    });
    const result = await planForIntent('acct-1', 'user-1', 'help', GMAIL_GCAL_STRIPE, gen, testRouter());
    if ('plan' in result) {
      // the bogus + web tools were dropped; the surviving plan validates
      expect(result.plan.toolsAllowlist).not.toContain('totally.bogus');
      expect(result.plan.toolsAllowlist).not.toContain('web.search');
      expect(validatePlanSpec(result.plan, GMAIL_GCAL_STRIPE, { webSearchEnabled: false })).toEqual([]);
    } else {
      // or it cleanly errors — never an invalid plan
      expect(result.error).toBeTruthy();
    }
  });

  it('drops a connector cap whose connector is not granted', async () => {
    const gen = fakeGenerate({
      goal: 'help',
      intendedSteps: ['x'],
      toolsAllowlist: ['email.read', 'payments.read', 'done'],
      requiredConnectors: ['gmail', 'stripe'],
    });
    // stripe NOT granted
    const result = await planForIntent('acct-1', 'user-1', 'help', ['gmail'], gen, testRouter());
    if ('plan' in result) {
      expect(result.plan.toolsAllowlist).not.toContain('payments.read');
      expect(result.plan.requiredConnectors).not.toContain('stripe');
      expect(validatePlanSpec(result.plan, ['gmail'], { webSearchEnabled: false })).toEqual([]);
    } else {
      expect(result.error).toBeTruthy();
    }
  });
});
