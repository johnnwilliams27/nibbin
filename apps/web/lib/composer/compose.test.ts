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

/** A triage / inbox-overwhelm email workflow → the read-only keep-or-clear
 *  digest (digest.inbox-cleanup), not a nudge. */
const TRIAGE_WF: DiagnosisWorkflow = {
  key: 'email.triage',
  label: 'Triaging newsletter overload',
  category: 'email',
  hoursPerWeek: 2,
  frequency: 'daily',
  friction: 'Too much email — newsletters pile up and you want to unsubscribe.',
  recommendedNibbin: 'sweep',
};

/** A morning-planning / daily-overview workflow → the 3-source morning brief
 *  (digest.morning). Category 'other' so the morning-brief text signal drives it. */
const DAILY_OVERVIEW_WF: DiagnosisWorkflow = {
  key: 'daily.overview',
  label: 'Pulling together a morning brief',
  category: 'other',
  hoursPerWeek: 1,
  frequency: 'daily',
  friction: 'You want to start the day with a daily overview and stay on top of things.',
  recommendedNibbin: 'brief',
};

/** A "morning ops" workflow that BOTH wants a daily brief AND mentions chasing
 *  overdue invoices → deterministic 2-primitive spec (digest.morning THEN
 *  nudge.overdue-invoice) when all three connectors are granted. */
const MORNING_OPS_WF: DiagnosisWorkflow = {
  key: 'daily.ops',
  label: 'Running the morning and chasing overdue invoices',
  category: 'other',
  hoursPerWeek: 2,
  frequency: 'daily',
  friction: 'You want a morning brief to start the day, then chase any overdue invoices that are past due.',
  recommendedNibbin: 'brief',
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

  it('surfaces unfulfilled.reason=connector_not_connected when the preferred primitive exists but connector is absent', async () => {
    // EMAIL_WF maps to nudge.overdue-email, which needs gmail — but no connectors granted.
    const result = await composeSpec('acct-1', 'user-1', EMAIL_WF, []);
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    // The preferred primitive is in the registry (gmail just isn't granted), so
    // the reason should be connector_not_connected and capability should be a known primitive id.
    expect(result.unfulfilled).toBeDefined();
    expect(result.unfulfilled?.reason).toBe('connector_not_connected');
    expect(typeof result.unfulfilled?.capability).toBe('string');
    expect(result.unfulfilled?.capability.length).toBeGreaterThan(0);
  });

  it('surfaces unfulfilled.capability as the preferred primitive id (connector_not_connected)', async () => {
    // A payments workflow maps to nudge.overdue-invoice — stripe not granted.
    const result = await composeSpec('acct-1', 'user-1', PAYMENTS_WF, []);
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.unfulfilled?.reason).toBe('connector_not_connected');
    // The preferred primitive for a payments workflow is nudge.overdue-invoice.
    expect(result.unfulfilled?.capability).toBe('nudge.overdue-invoice');
  });

  it('surfaces unfulfilled.reason=no_capability with the category for an unserved workflow', async () => {
    // A workflow whose category has NO genuine primitive (social/docs/crm/other,
    // no morning-brief signal) → roadmap gap. The emitted capability is the
    // structural WorkflowCategory enum, never the free-text workflow.key.
    const unserved: DiagnosisWorkflow = {
      key: 'social.dms',
      label: 'Replying to social DMs',
      category: 'other',
      hoursPerWeek: 1,
      frequency: 'daily',
      friction: null,
      recommendedNibbin: 'scribe',
    };
    const result = await composeSpec('acct-1', 'user-1', unserved, []);
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.unfulfilled?.reason).toBe('no_capability');
    expect(result.unfulfilled?.capability).toBe('other');
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

  it('no-key fallback maps a triage/inbox-overwhelm workflow → digest.inbox-cleanup (presentation, validates)', async () => {
    const result = await composeSpec('acct-1', 'user-1', TRIAGE_WF, ['gmail']);
    if ('error' in result) throw new Error(result.error);
    expect(result.spec.steps?.[0]?.capability).toBe('digest.inbox-cleanup');
    expect(result.spec.requiredConnectors).toEqual(['gmail']);
    expect(result.spec.toolsAllowlist).toEqual(['email.read']);
    expect(validateComposedSpec(result.spec, ['gmail'])).toEqual([]);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('no-key fallback maps a daily-overview workflow → digest.morning with ALL THREE connectors derived', async () => {
    const result = await composeSpec('acct-1', 'user-1', DAILY_OVERVIEW_WF, ['google-calendar', 'stripe', 'gmail']);
    if ('error' in result) throw new Error(result.error);
    expect(result.spec.steps?.[0]?.capability).toBe('digest.morning');
    // 3-connector derivation server-side from effectiveTools.
    expect([...result.spec.requiredConnectors].sort()).toEqual(['gmail', 'google-calendar', 'stripe']);
    expect(result.spec.toolsAllowlist).toEqual(['calendar.read', 'payments.read', 'email.read']);
    expect(validateComposedSpec(result.spec, ['google-calendar', 'stripe', 'gmail'])).toEqual([]);
  });

  it('hides digest.morning when only gmail is granted → falls back to an available primitive (never invalid)', async () => {
    // The daily-overview workflow maps to digest.morning, but with only gmail
    // granted its 3 connectors aren't all present → it isn't available. The
    // fallback must pick an AVAILABLE gmail primitive (never an invalid spec).
    const result = await composeSpec('acct-1', 'user-1', DAILY_OVERVIEW_WF, ['gmail']);
    if ('error' in result) throw new Error(result.error);
    expect(result.spec.steps?.[0]?.capability).not.toBe('digest.morning');
    // Whatever it picked must be a gmail-only primitive that passes validation.
    expect(validateComposedSpec(result.spec, ['gmail'])).toEqual([]);
  });

  it('no-key fallback proposes a VALID 2-primitive spec for a multi-resource morning-ops workflow', async () => {
    const result = await composeSpec('acct-1', 'user-1', MORNING_OPS_WF, ['google-calendar', 'stripe', 'gmail']);
    if ('error' in result) throw new Error(result.error);
    // Ordered: present the brief first, then draft the overdue-invoice nudge.
    expect(result.spec.steps?.map((s) => s.capability)).toEqual(['digest.morning', 'nudge.overdue-invoice']);
    // UNION of both primitives' tools + connectors, derived server-side.
    expect([...result.spec.requiredConnectors].sort()).toEqual(['gmail', 'google-calendar', 'stripe']);
    expect(result.spec.toolsAllowlist).toContain('invoice.nudge');
    expect(result.spec.toolsAllowlist).toContain('calendar.read');
    expect(validateComposedSpec(result.spec, ['google-calendar', 'stripe', 'gmail'])).toEqual([]);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('stays SINGLE-primitive for the morning-ops workflow when stripe is not granted (fail-safe)', async () => {
    // Without stripe, nudge.overdue-invoice isn't available, so the multi-step
    // warrant is skipped — a valid single-primitive brief... but digest.morning
    // needs stripe too, so it falls back to an available gmail primitive.
    const result = await composeSpec('acct-1', 'user-1', MORNING_OPS_WF, ['gmail']);
    if ('error' in result) throw new Error(result.error);
    expect(result.spec.steps?.length).toBe(1);
    expect(validateComposedSpec(result.spec, ['gmail'])).toEqual([]);
  });

  it('accepts a MULTI-STEP model pick on the menu and validates fail-closed', async () => {
    const generate: Generate = vi.fn(async () =>
      fakeResult(
        JSON.stringify({
          displayName: 'Morning ops',
          steps: [
            { capability: 'digest.morning', inputs: {} },
            { capability: 'nudge.overdue-invoice', inputs: { minDaysLate: 5 } },
          ],
          personaPolicy: { tone: 'gentle' },
        }),
      ),
    );
    const result = await composeSpec(
      'acct-1', 'user-1', MORNING_OPS_WF, ['google-calendar', 'stripe', 'gmail'], [], generate, testRouter(),
    );
    if ('error' in result) throw new Error(result.error);
    expect(result.spec.steps?.map((s) => s.capability)).toEqual(['digest.morning', 'nudge.overdue-invoice']);
    expect(result.spec.steps?.[1]?.inputs?.minDaysLate).toBe(5);
    expect(validateComposedSpec(result.spec, ['google-calendar', 'stripe', 'gmail'])).toEqual([]);
  });

  it('falls back deterministically when a model multi-step pick has an off-menu step', async () => {
    const generate: Generate = vi.fn(async () =>
      fakeResult(
        JSON.stringify({
          displayName: 'Bad ops',
          steps: [
            { capability: 'digest.morning', inputs: {} },
            { capability: 'send.everything', inputs: {} },
          ],
        }),
      ),
    );
    const result = await composeSpec(
      'acct-1', 'user-1', MORNING_OPS_WF, ['google-calendar', 'stripe', 'gmail'], [], generate, testRouter(),
    );
    if ('error' in result) throw new Error(result.error);
    // The whole draft is rejected; the deterministic morning-ops proposal stands.
    expect(result.spec.steps?.every((s) => s.capability !== 'send.everything')).toBe(true);
    expect(validateComposedSpec(result.spec, ['google-calendar', 'stripe', 'gmail'])).toEqual([]);
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
