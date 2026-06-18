/**
 * Composer (Slice 2a) plumbing: the no-key fallback proposes a VALID
 * nudge.overdue-email spec (so synthesis works with no model — CI-safe), the
 * proposal is fail-closed validated, and a workflow with no available primitive
 * (the connector it needs isn't connected) returns an error.
 *
 * Live quality is the eval suite's job; this proves the safety plumbing.
 */
import { describe, expect, it, vi } from 'vitest';
import { validateComposedSpec } from '@nibbin/runtime';
import { createRouter, InMemoryBudgetStore, type Generate, type GenerateResult, type Router } from '@nibbin/router';
import type { DiagnosisWorkflow } from '../diagnosis/types';
import { composeSpec } from './compose';

/** A router with an in-memory budget (no DB). `budget` sets the per-user/day
 *  frontier cap — `0` forces immediate degradation (budget exhausted). The
 *  composer routes custom_spec_draft as origin:'chat', so this budget applies. */
function testRouter(budget = 5): Router {
  return createRouter({ dailyFrontierBudget: budget, budgetStore: new InMemoryBudgetStore() });
}

// recordModelCall writes to the service client (a DB) — stub it so the LLM-path
// test doesn't need one. The no-key path never calls it.
vi.mock('../llm/client', () => ({
  recordModelCall: vi.fn(async () => {}),
  anthropicGenerate: () => null,
}));

const EMAIL_WF: DiagnosisWorkflow = {
  key: 'email.overdue',
  label: 'Chasing overdue replies',
  category: 'email',
  hoursPerWeek: 3,
  frequency: 'daily',
  friction: 'Threads go quiet and you forget to circle back.',
  recommendedNibbin: 'echo',
};

const PAYMENTS_WF: DiagnosisWorkflow = {
  key: 'payments.overdue',
  label: 'Chasing unpaid invoices',
  category: 'payments',
  hoursPerWeek: 2,
  frequency: 'weekly',
  friction: 'Invoices go past due and you forget to follow up.',
  recommendedNibbin: 'tally',
};

const CALENDAR_WF: DiagnosisWorkflow = {
  key: 'calendar.confirm',
  label: 'Confirming upcoming sessions',
  category: 'calendar',
  hoursPerWeek: 1,
  frequency: 'weekly',
  friction: 'Guests forget to confirm and you chase them.',
  recommendedNibbin: 'hopper',
};

const INQUIRY_WF: DiagnosisWorkflow = {
  key: 'email.inquiries',
  label: 'Answering new client inquiries',
  category: 'email',
  hoursPerWeek: 4,
  frequency: 'daily',
  friction: 'First-contact inquiries pile up and replies are slow.',
  recommendedNibbin: 'scribe',
};

function fakeResult(text: string): GenerateResult {
  return {
    text,
    model: 'claude-sonnet-4-6',
    stopReason: 'end_turn',
    usage: { inputTokens: 200, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 60 },
  };
}

describe('composeSpec', () => {
  it('no-key fallback proposes a valid nudge.overdue-email spec', async () => {
    const result = await composeSpec('acct-1', 'user-1', EMAIL_WF, ['gmail']);
    expect('error' in result).toBe(false);
    if ('error' in result) throw new Error(result.error);

    expect(result.spec.templateKey).toBeNull();
    expect(result.spec.steps?.[0]?.capability).toBe('nudge.overdue-email');
    expect(result.spec.toolsAllowlist).toEqual(['email.read', 'email.draft']);
    expect(result.spec.requiredConnectors).toEqual(['gmail']);
    // The assembled spec passes the fail-closed gate.
    expect(validateComposedSpec(result.spec, ['gmail'])).toEqual([]);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('returns an error when no primitive is available (connector not connected)', async () => {
    const result = await composeSpec('acct-1', 'user-1', EMAIL_WF, []); // no gmail
    expect('error' in result).toBe(true);
  });

  it('no-key fallback maps a payments workflow → nudge.overdue-invoice (validates)', async () => {
    const result = await composeSpec('acct-1', 'user-1', PAYMENTS_WF, ['stripe']);
    if ('error' in result) throw new Error(result.error);
    expect(result.spec.steps?.[0]?.capability).toBe('nudge.overdue-invoice');
    expect(result.spec.requiredConnectors).toEqual(['stripe']);
    expect(result.spec.toolsAllowlist).toEqual(['payments.read', 'invoice.nudge']);
    expect(validateComposedSpec(result.spec, ['stripe'])).toEqual([]);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('no-key fallback maps a calendar workflow → nudge.unconfirmed-event with BOTH connectors derived', async () => {
    const result = await composeSpec('acct-1', 'user-1', CALENDAR_WF, ['google-calendar', 'gmail']);
    if ('error' in result) throw new Error(result.error);
    expect(result.spec.steps?.[0]?.capability).toBe('nudge.unconfirmed-event');
    // The cross-resource primitive's connectors are derived server-side from
    // effectiveTools (calendar.read→gcal, email.draft→gmail) — both required.
    expect([...result.spec.requiredConnectors].sort()).toEqual(['gmail', 'google-calendar']);
    expect(result.spec.toolsAllowlist).toEqual(['calendar.read', 'email.draft']);
    expect(validateComposedSpec(result.spec, ['google-calendar', 'gmail'])).toEqual([]);
  });

  it('no-key fallback maps an inquiry-signal email workflow → reply.new-inquiry', async () => {
    const result = await composeSpec('acct-1', 'user-1', INQUIRY_WF, ['gmail']);
    if ('error' in result) throw new Error(result.error);
    expect(result.spec.steps?.[0]?.capability).toBe('reply.new-inquiry');
    expect(validateComposedSpec(result.spec, ['gmail'])).toEqual([]);
  });

  it('hides the cross-resource primitive when only ONE of its connectors is granted', async () => {
    // calendar workflow, but only gcal connected (no gmail). nudge.unconfirmed-event
    // isn't available, so the fallback picks an available primitive (or errors if
    // none) — never an unrunnable cross-resource spec.
    const result = await composeSpec('acct-1', 'user-1', CALENDAR_WF, ['google-calendar']);
    // gcal alone powers no primitive (every primitive needs gmail or stripe), so
    // this account can build nothing for the calendar workflow → error.
    expect('error' in result).toBe(true);
  });

  it('falls back to an available primitive when the mapped one is unrunnable', async () => {
    // A payments workflow but stripe is NOT connected; gmail IS. The mapped
    // invoice primitive is unavailable, so synthesis falls back to an available
    // email primitive rather than failing.
    const result = await composeSpec('acct-1', 'user-1', PAYMENTS_WF, ['gmail']);
    if ('error' in result) throw new Error(result.error);
    expect(['nudge.overdue-email', 'reply.new-inquiry']).toContain(result.spec.steps?.[0]?.capability);
    expect(validateComposedSpec(result.spec, ['gmail'])).toEqual([]);
  });

  it('accepts a model pick on the menu and still validates fail-closed', async () => {
    const generate: Generate = vi.fn(async () =>
      fakeResult(
        JSON.stringify({
          displayName: 'Inbox follow-ups',
          capability: 'nudge.overdue-email',
          inputs: { staleDays: 5 },
          personaPolicy: { tone: 'gentle' },
        }),
      ),
    );
    const result = await composeSpec('acct-1', 'user-1', EMAIL_WF, ['gmail'], [], generate, testRouter());
    expect('error' in result).toBe(false);
    if ('error' in result) throw new Error(result.error);
    expect(result.spec.displayName).toBe('Inbox follow-ups');
    expect(result.spec.steps?.[0]?.inputs?.staleDays).toBe(5);
    expect(validateComposedSpec(result.spec, ['gmail'])).toEqual([]);
  });

  it('falls back deterministically when the model returns junk', async () => {
    const generate: Generate = vi.fn(async () => fakeResult('not json at all'));
    const result = await composeSpec('acct-1', 'user-1', EMAIL_WF, ['gmail'], [], generate, testRouter());
    expect('error' in result).toBe(false);
    if ('error' in result) throw new Error(result.error);
    // Deterministic default params (staleDays omitted → interpreter default 3).
    expect(result.spec.steps?.[0]?.capability).toBe('nudge.overdue-email');
    expect(validateComposedSpec(result.spec, ['gmail'])).toEqual([]);
  });

  it('ignores an off-menu model pick and uses the deterministic primitive', async () => {
    const generate: Generate = vi.fn(async () =>
      fakeResult(JSON.stringify({ capability: 'send.everything', inputs: {} })),
    );
    const result = await composeSpec('acct-1', 'user-1', EMAIL_WF, ['gmail'], [], generate, testRouter());
    expect('error' in result).toBe(false);
    if ('error' in result) throw new Error(result.error);
    expect(result.spec.steps?.[0]?.capability).toBe('nudge.overdue-email');
  });

  it('throttles to the deterministic proposal when the frontier budget is spent (gate P1)', async () => {
    // budget 0 → route() degrades immediately. composeSpec must NOT call the
    // model (the entry point is now bounded) and stands on the deterministic
    // no-model proposal — synthesis still works, no COGS, no throw to the user.
    const generate = vi.fn(async () =>
      fakeResult(JSON.stringify({ displayName: 'Should not be used', capability: 'nudge.overdue-email', inputs: { staleDays: 7 } })),
    );
    const result = await composeSpec('acct-1', 'user-1', EMAIL_WF, ['gmail'], [], generate as unknown as Generate, testRouter(0));
    expect(generate).not.toHaveBeenCalled();
    expect('error' in result).toBe(false);
    if ('error' in result) throw new Error(result.error);
    // Deterministic default name + params (NOT the model's "Should not be used"/7).
    expect(result.spec.displayName).toBe('Overdue follow-ups');
    expect(result.spec.steps?.[0]?.capability).toBe('nudge.overdue-email');
    expect(validateComposedSpec(result.spec, ['gmail'])).toEqual([]);
  });

  it('draws the per-user budget once per call (bounded at the daily cap)', async () => {
    // With budget 1, the first call uses the model; the second degrades to the
    // deterministic proposal — proving custom_spec_draft is now budgeted.
    const generate = vi.fn(async () =>
      fakeResult(JSON.stringify({ displayName: 'Inbox follow-ups', capability: 'nudge.overdue-email', inputs: { staleDays: 5 } })),
    );
    const router = testRouter(1);
    const first = await composeSpec('acct-1', 'user-1', EMAIL_WF, ['gmail'], [], generate as unknown as Generate, router);
    const second = await composeSpec('acct-1', 'user-1', EMAIL_WF, ['gmail'], [], generate as unknown as Generate, router);
    if ('error' in first || 'error' in second) throw new Error('unexpected error result');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(first.spec.displayName).toBe('Inbox follow-ups'); // model pick
    expect(second.spec.displayName).toBe('Overdue follow-ups'); // deterministic
  });
});
