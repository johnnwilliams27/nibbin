import { describe, it, expect } from 'vitest';
import { parseAdjustment } from './adjust';

describe('parseAdjustment (staff credit adjustment → signed delta)', () => {
  it('a grant is a positive delta', () => {
    expect(parseAdjustment({ amount: '500', direction: 'grant', reason: 'goodwill' })).toEqual({
      delta: 500,
      reason: 'goodwill',
    });
  });

  it('a clawback is a negative delta', () => {
    expect(parseAdjustment({ amount: '200', direction: 'clawback', reason: 'chargeback' })).toEqual({
      delta: -200,
      reason: 'chargeback',
    });
  });

  it('trims the reason', () => {
    expect(parseAdjustment({ amount: '10', direction: 'grant', reason: '  refund goodwill  ' }).reason).toBe(
      'refund goodwill',
    );
  });

  it('rejects a missing or whitespace reason (mandatory, §6.10)', () => {
    expect(() => parseAdjustment({ amount: '10', direction: 'grant', reason: '' })).toThrow(/reason/i);
    expect(() => parseAdjustment({ amount: '10', direction: 'grant', reason: '   ' })).toThrow(/reason/i);
  });

  it('rejects non-positive, fractional, or non-numeric amounts', () => {
    for (const amount of ['0', '-5', '1.5', 'abc', '']) {
      expect(() => parseAdjustment({ amount, direction: 'grant', reason: 'r' }), amount).toThrow(/amount/i);
    }
  });

  it('rejects an unknown direction', () => {
    // @ts-expect-error testing runtime guard
    expect(() => parseAdjustment({ amount: '10', direction: 'bonus', reason: 'r' })).toThrow(/direction/i);
  });

  it('rejects an amount beyond the safe integer range', () => {
    expect(() => parseAdjustment({ amount: '99999999999999999', direction: 'grant', reason: 'r' })).toThrow(
      /amount/i,
    );
  });
});
