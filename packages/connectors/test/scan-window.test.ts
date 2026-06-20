import { expect, it, describe } from 'vitest';
import { SCAN_WINDOW_MONTHS, scanWindowEndingAt } from '../src/types';

describe('scan window', () => {
  it('is a 12-month lookback', () => {
    expect(SCAN_WINDOW_MONTHS).toBe(12);
  });

  it('spans ~365 days ending at the given instant', () => {
    const end = 1_700_000_000_000;
    const w = scanWindowEndingAt(end);
    expect(w.endMs).toBe(end);
    const days = (w.endMs - w.startMs) / 86_400_000;
    expect(days).toBe(365);
  });
});
