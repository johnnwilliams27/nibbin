import { describe, expect, it } from 'vitest';
import { createRouter, type RoutedTask, type Tier, type RouteRequest } from '../src/index';

/**
 * Slice B zero-regression pin: with the DEFAULT config (one candidate per task,
 * no performance source), route() must return EXACTLY the model it returned
 * before the reinforcement seam was added. Hardcoded model ids — if a model pin
 * legitimately changes (eval-gated), this test changes WITH the config in the
 * same commit, by design. A change here that is NOT a deliberate repin is a
 * routing regression the seam introduced.
 */
const T2_CHAT = `Plan a complete end-to-end overhaul of my booking workflow. First, audit the current intake.
  Then design the new flow step by step:
  1. capture 2. qualify 3. follow up
  Finally, summarize the strategy.`;

describe('route() is byte-for-byte unchanged with one candidate / no perf source', () => {
  const HAIKU = 'claude-haiku-4-5-20251001';
  const SONNET = 'claude-sonnet-4-6';
  const OPUS = 'claude-opus-4-8';

  // [task, origin, expected model id] for a generous-budget router.
  const cases: Array<[RoutedTask, RouteRequest['origin'], string]> = [
    // T0
    ['smalltalk', 'pipeline', HAIKU],
    ['intent_classification', 'pipeline', HAIKU],
    ['routing', 'pipeline', HAIKU],
    ['formatting', 'pipeline', HAIKU],
    ['field_notes_copy', 'pipeline', HAIKU],
    ['journal_phrasing', 'pipeline', HAIKU],
    // T1 — incl. the prompt-named pins
    ['specialist_draft', 'pipeline', HAIKU],
    ['scan_synthesis', 'pipeline', HAIKU],
    ['onboarding_understanding', 'pipeline', HAIKU],
    ['training_feedback', 'pipeline', HAIKU],
    ['map_labeling', 'pipeline', HAIKU],
    ['sweep_pass1', 'pipeline', HAIKU],
    ['sweep_pass2', 'pipeline', HAIKU],
    ['memory_extract', 'pipeline', HAIKU],
    // T2 — tier default + Opus pins
    ['diagnosis_synthesis', 'pipeline', OPUS],
    ['nibbin_note', 'pipeline', OPUS],
    ['custom_spec_draft', 'pipeline', SONNET],
    ['complex_plan', 'pipeline', SONNET],
    ['plan_synthesis', 'chat', SONNET],
  ];

  it.each(cases)('%s (%s) → %s', async (task, origin, expected) => {
    const router = createRouter({ dailyFrontierBudget: 100 });
    const decision = await router.route({ userId: 'u', task, origin });
    expect(decision.model).toBe(expected);
  });

  it('chat that classifies T2 routes to the Sonnet tier default', async () => {
    const router = createRouter({ dailyFrontierBudget: 100 });
    const decision = await router.route({ userId: 'u', task: 'chat', origin: 'chat', text: T2_CHAT });
    expect(decision.tier).toBe('t2');
    expect(decision.model).toBe(SONNET);
  });

  it('a router constructed with an EMPTY perf source still serves the static default', async () => {
    // Even when wired, an empty snapshot (the steady state until traffic accrues
    // + a 2nd candidate is added) changes nothing.
    const router = createRouter({
      dailyFrontierBudget: 100,
      performance: { getPerformance: () => undefined },
    });
    for (const [task, origin, expected] of cases) {
      const decision = await router.route({ userId: 'u', task, origin });
      expect(decision.model, `${task}`).toBe(expected);
    }
  });

  it('the tier table still maps every non-chat task (no tier drift)', async () => {
    const router = createRouter({ dailyFrontierBudget: 100 });
    const tierOf: Array<[RoutedTask, Tier]> = [
      ['specialist_draft', 't1'],
      ['diagnosis_synthesis', 't2'],
      ['plan_synthesis', 't2'],
    ];
    for (const [task, tier] of tierOf) {
      const d = await router.route({ userId: 'u', task, origin: task === 'plan_synthesis' ? 'chat' : 'pipeline' });
      expect(d.requestedTier, task).toBe(tier);
    }
  });
});
