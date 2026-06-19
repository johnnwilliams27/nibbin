import { describe, expect, it } from 'vitest';
import {
  chooseModel,
  createRouter,
  DEFAULT_MODELS,
  DEFAULT_REINFORCEMENT,
  DEFAULT_TASK_MODELS,
  type PerfStat,
  type PerformanceSource,
  type ReinforcementParams,
  type RoutedTask,
  type RouteRequest,
  type Tier,
} from '../src/index';

/** A fake performance source backed by a plain (model|task|tier) → stat map. */
function fakeSource(rows: Record<string, Partial<PerfStat>>): PerformanceSource {
  const full = (p: Partial<PerfStat>): PerfStat => ({
    calls: p.calls ?? p.decidedCalls ?? 0,
    decidedCalls: p.decidedCalls ?? 0,
    approvedUneditedRate: p.approvedUneditedRate ?? 0,
    refusalErrorRate: p.refusalErrorRate ?? 0,
    avgCostMicroUsd: p.avgCostMicroUsd ?? 0,
  });
  return {
    getPerformance(model, task, tier) {
      const row = rows[`${model}|${task}|${tier}`];
      return row ? full(row) : undefined;
    },
  };
}

const params: ReinforcementParams = DEFAULT_REINFORCEMENT;
const t: RoutedTask = 'specialist_draft';
const tier: Tier = 't1';
const A = 'model-a-default';
const B = 'model-b-cheaper';
const C = 'model-c-expensive';

describe('chooseModel — invariants', () => {
  it('one candidate returns it unchanged (no data needed)', () => {
    expect(chooseModel([A], t, tier, fakeSource({}), params)).toBe(A);
  });

  it('no performance source returns the default (candidates[0])', () => {
    expect(chooseModel([A, B], t, tier, undefined, params)).toBe(A);
  });

  it('only ever returns a member of the candidate set', () => {
    const src = fakeSource({
      [`${A}|${t}|${tier}`]: { decidedCalls: 100, approvedUneditedRate: 0.5, avgCostMicroUsd: 100 },
      [`${B}|${t}|${tier}`]: { decidedCalls: 100, approvedUneditedRate: 0.99, avgCostMicroUsd: 1 },
    });
    const picked = chooseModel([A, B], t, tier, src, params);
    expect([A, B]).toContain(picked);
  });
});

describe('chooseModel — min-volume floor', () => {
  it('holds the default when the incumbent lacks the volume floor', () => {
    const src = fakeSource({
      // default just under the floor; challenger looks amazing but the window
      // is too cold to trust any reweighting.
      [`${A}|${t}|${tier}`]: { decidedCalls: params.minDecidedCalls - 1, approvedUneditedRate: 0.5, avgCostMicroUsd: 100 },
      [`${B}|${t}|${tier}`]: { decidedCalls: 1000, approvedUneditedRate: 0.99, avgCostMicroUsd: 1 },
    });
    expect(chooseModel([A, B], t, tier, src, params)).toBe(A);
  });

  it('a thin challenger never unseats a qualified incumbent', () => {
    const src = fakeSource({
      [`${A}|${t}|${tier}`]: { decidedCalls: 100, approvedUneditedRate: 0.6, avgCostMicroUsd: 100 },
      // challenger is cheaper + higher quality but below the decided floor.
      [`${B}|${t}|${tier}`]: { decidedCalls: params.minDecidedCalls - 1, approvedUneditedRate: 0.95, avgCostMicroUsd: 1 },
    });
    expect(chooseModel([A, B], t, tier, src, params)).toBe(A);
  });
});

describe('chooseModel — quality-within-budget + P8 cost-aware', () => {
  it('prefers the cheaper candidate when quality is within tolerance (P8)', () => {
    const src = fakeSource({
      [`${A}|${t}|${tier}`]: { decidedCalls: 100, approvedUneditedRate: 0.80, avgCostMicroUsd: 100 },
      // within the 0.03 tolerance of A, but far cheaper ⇒ B wins.
      [`${B}|${t}|${tier}`]: { decidedCalls: 100, approvedUneditedRate: 0.78, avgCostMicroUsd: 5 },
    });
    expect(chooseModel([A, B], t, tier, src, params)).toBe(B);
  });

  it('keeps the pricier candidate when it is meaningfully better than tolerance', () => {
    const src = fakeSource({
      [`${A}|${t}|${tier}`]: { decidedCalls: 100, approvedUneditedRate: 0.90, avgCostMicroUsd: 100 },
      // cheaper but a full 10pts worse — outside tolerance ⇒ A stays.
      [`${B}|${t}|${tier}`]: { decidedCalls: 100, approvedUneditedRate: 0.80, avgCostMicroUsd: 5 },
    });
    expect(chooseModel([A, B], t, tier, src, params)).toBe(A);
  });

  it('picks the cheapest among several within-tolerance candidates', () => {
    const src = fakeSource({
      [`${A}|${t}|${tier}`]: { decidedCalls: 100, approvedUneditedRate: 0.80, avgCostMicroUsd: 100 },
      [`${B}|${t}|${tier}`]: { decidedCalls: 100, approvedUneditedRate: 0.79, avgCostMicroUsd: 5 },
      [`${C}|${t}|${tier}`]: { decidedCalls: 100, approvedUneditedRate: 0.78, avgCostMicroUsd: 50 },
    });
    expect(chooseModel([A, B, C], t, tier, src, params)).toBe(B);
  });

  it('equal quality + equal cost holds the default (lower rank wins the tie)', () => {
    const src = fakeSource({
      [`${A}|${t}|${tier}`]: { decidedCalls: 100, approvedUneditedRate: 0.80, avgCostMicroUsd: 50 },
      [`${B}|${t}|${tier}`]: { decidedCalls: 100, approvedUneditedRate: 0.80, avgCostMicroUsd: 50 },
    });
    expect(chooseModel([A, B], t, tier, src, params)).toBe(A);
  });
});

describe('chooseModel — exclusions / churn', () => {
  it('drops a candidate below the quality bar even if cheap', () => {
    const src = fakeSource({
      [`${A}|${t}|${tier}`]: { decidedCalls: 100, approvedUneditedRate: 0.60, avgCostMicroUsd: 100 },
      // rejected most of the time — never "cheapest-acceptable".
      [`${B}|${t}|${tier}`]: { decidedCalls: 100, approvedUneditedRate: 0.20, avgCostMicroUsd: 1 },
    });
    expect(chooseModel([A, B], t, tier, src, params)).toBe(A);
  });

  it('drops a churning candidate (refusal/error spike) even if quality+cost look good', () => {
    const src = fakeSource({
      [`${A}|${t}|${tier}`]: { decidedCalls: 100, approvedUneditedRate: 0.70, avgCostMicroUsd: 100 },
      // high approved rate + cheap, but refusing/erroring 40% of calls.
      [`${B}|${t}|${tier}`]: { decidedCalls: 100, approvedUneditedRate: 0.95, avgCostMicroUsd: 1, refusalErrorRate: 0.4 },
    });
    expect(chooseModel([A, B], t, tier, src, params)).toBe(A);
  });

  it('falls back to the default when a challenger has no data row', () => {
    const src = fakeSource({
      [`${A}|${t}|${tier}`]: { decidedCalls: 100, approvedUneditedRate: 0.80, avgCostMicroUsd: 100 },
      // B absent entirely
    });
    expect(chooseModel([A, B], t, tier, src, params)).toBe(A);
  });

  it('moves off a default that is itself churning, to an eligible challenger', () => {
    const src = fakeSource({
      // incumbent cleared volume but is now erroring badly + low quality.
      [`${A}|${t}|${tier}`]: { decidedCalls: 100, approvedUneditedRate: 0.30, avgCostMicroUsd: 100, refusalErrorRate: 0.5 },
      [`${B}|${t}|${tier}`]: { decidedCalls: 100, approvedUneditedRate: 0.85, avgCostMicroUsd: 5 },
    });
    expect(chooseModel([A, B], t, tier, src, params)).toBe(B);
  });
});

describe('router integration — reinforcement only diverges with ≥2 candidates + data', () => {
  const draftReq: RouteRequest = { userId: 'u', task: 'specialist_draft', origin: 'pipeline' };

  it('with a 2nd eval-cleared candidate + cheaper-equal-quality data, route() shifts', async () => {
    const t1Default = DEFAULT_MODELS.t1;
    const cheaper = 'claude-haiku-4-5-cheaper-variant';
    const router = createRouter({
      dailyFrontierBudget: 100,
      taskCandidates: { specialist_draft: [cheaper] },
      performance: fakeSource({
        [`${t1Default}|specialist_draft|t1`]: { decidedCalls: 100, approvedUneditedRate: 0.80, avgCostMicroUsd: 100 },
        [`${cheaper}|specialist_draft|t1`]: { decidedCalls: 100, approvedUneditedRate: 0.79, avgCostMicroUsd: 5 },
      }),
    });
    const decision = await router.route(draftReq);
    expect(decision.tier).toBe('t1');
    expect(decision.model).toBe(cheaper);
  });

  it('the same config with NO performance source serves the static default', async () => {
    const cheaper = 'claude-haiku-4-5-cheaper-variant';
    const router = createRouter({
      dailyFrontierBudget: 100,
      taskCandidates: { specialist_draft: [cheaper] },
    });
    const decision = await router.route(draftReq);
    expect(decision.model).toBe(DEFAULT_MODELS.t1);
  });

  it('reinforcement never applies to a budget-degraded tier (serves the plain default)', async () => {
    // chat that classifies t2 but is degraded to t1 by a zero budget. Even if
    // a t1 candidate set + glowing data exists, the degraded path serves the
    // plain t1 default unchanged.
    const cheaper = 'claude-haiku-4-5-cheaper-variant';
    const router = createRouter({
      dailyFrontierBudget: 0,
      taskCandidates: { chat: [cheaper] },
      performance: fakeSource({
        [`${cheaper}|chat|t1`]: { decidedCalls: 100, approvedUneditedRate: 0.99, avgCostMicroUsd: 1 },
        [`${DEFAULT_MODELS.t1}|chat|t1`]: { decidedCalls: 100, approvedUneditedRate: 0.50, avgCostMicroUsd: 100 },
      }),
    });
    const T2_CHAT = `Plan a complete end-to-end overhaul. First audit. Then design step by step:
      1. capture 2. qualify 3. follow up. Finally summarize the strategy.`;
    const decision = await router.route({ userId: 'u', task: 'chat', origin: 'chat', text: T2_CHAT });
    expect(decision.degraded).toBe(true);
    expect(decision.model).toBe(DEFAULT_MODELS.t1);
  });

  it('the Opus diagnosis pin is the lead candidate; reinforcement honors it as fallback', async () => {
    // diagnosis_synthesis is pinned to Opus. With NO candidate override, the
    // pin is the sole candidate ⇒ unchanged. (Guards the pin against the seam.)
    const router = createRouter({ dailyFrontierBudget: 100 });
    const decision = await router.route({ userId: 'u', task: 'diagnosis_synthesis', origin: 'pipeline' });
    expect(decision.model).toBe(DEFAULT_TASK_MODELS.diagnosis_synthesis);
    expect(decision.model).toBe('claude-opus-4-8');
  });
});
