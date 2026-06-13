import { describe, expect, it } from 'vitest';
import { TIER_FOR_TASK } from '../src/tiers';

describe('onboarding_understanding tier', () => {
  it('routes onboarding understanding to the cheap T1 tier', () => {
    expect(TIER_FOR_TASK.onboarding_understanding).toBe('t1');
  });
});
