/**
 * Unit tests for stakes-score.ts — real stakes scoring for field conflicts.
 *
 * Pure: no I/O, no model calls, no DB.
 * Run: npx vitest run apps/web/lib/brain/stakes-score.test.ts
 */
import { describe, it, expect } from 'vitest';
import { scoreStakes, type StakesSignals } from './stakes-score';

const DEFAULT_AUTHORITY = {
  document: 70,
  manual: 65,
  connector_artifact: 50,
  observation: 40,
} as const;

function signals(partial: Partial<StakesSignals>): StakesSignals {
  return {
    fieldKey: 'faq',
    competingKinds: ['document', 'observation'],
    distinctValueCount: 2,
    authority: DEFAULT_AUTHORITY,
    ...partial,
  };
}

describe('scoreStakes — output domain', () => {
  it('only ever returns normal or high', () => {
    const out = scoreStakes(signals({}));
    expect(out === 'normal' || out === 'high').toBe(true);
  });
});

describe('scoreStakes — field criticality', () => {
  it('pricing conflicts are high even with a low-key disagreement', () => {
    expect(scoreStakes(signals({ fieldKey: 'pricing' }))).toBe('high');
  });

  it('policies conflicts are high', () => {
    expect(scoreStakes(signals({ fieldKey: 'policies' }))).toBe('high');
  });

  it('hard_rules conflicts are high', () => {
    expect(scoreStakes(signals({ fieldKey: 'hard_rules' }))).toBe('high');
  });

  it('a single low-trust 2-way disagreement on a non-critical field is normal', () => {
    expect(
      scoreStakes(
        signals({
          fieldKey: 'faq',
          competingKinds: ['observation', 'connector_artifact'],
          distinctValueCount: 2,
        }),
      ),
    ).toBe('normal');
  });
});

describe('scoreStakes — accumulating signals escalate non-critical fields', () => {
  it('many sources + many distinct values + high authority escalates a plain field to high', () => {
    expect(
      scoreStakes(
        signals({
          fieldKey: 'voice',
          competingKinds: ['document', 'document', 'manual'],
          distinctValueCount: 3,
        }),
      ),
    ).toBe('high');
  });

  it('two high-authority sources disagreeing crosses to high; two low-authority stays normal', () => {
    // High-auth: extraSources(1)*2 + 2 high-auth*2 = 6 ≥ 5 → high.
    const highAuth = scoreStakes(
      signals({ fieldKey: 'facts', competingKinds: ['document', 'manual'], distinctValueCount: 2 }),
    );
    // Low-auth (both observation, weight 40 < 60): extraSources(1)*2 + 0 = 2 < 5 → normal.
    const lowAuth = scoreStakes(
      signals({ fieldKey: 'facts', competingKinds: ['observation', 'observation'], distinctValueCount: 2 }),
    );
    // Proves the authority signal actually fires (not just monotonicity).
    expect(highAuth).toBe('high');
    expect(lowAuth).toBe('normal');
  });
});

describe('scoreStakes — robustness', () => {
  it('handles an unknown source kind without throwing', () => {
    expect(() =>
      scoreStakes(
        signals({
          // @ts-expect-error deliberately exercising an unmapped kind
          competingKinds: ['document', 'mystery'],
        }),
      ),
    ).not.toThrow();
  });

  it('handles empty competingKinds without throwing and stays normal for a plain field', () => {
    expect(scoreStakes(signals({ fieldKey: 'faq', competingKinds: [], distinctValueCount: 0 }))).toBe(
      'normal',
    );
  });
});
