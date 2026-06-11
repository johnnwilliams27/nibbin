import { describe, it, expect } from 'vitest';
import { canAdjustCredits, canImpersonate } from './rbac';

describe('staff RBAC (§6.10)', () => {
  it('support and superadmin can adjust credits; engineer cannot', () => {
    expect(canAdjustCredits('support')).toBe(true);
    expect(canAdjustCredits('superadmin')).toBe(true);
    expect(canAdjustCredits('engineer')).toBe(false);
  });

  it('support and superadmin can impersonate; engineer cannot', () => {
    expect(canImpersonate('support')).toBe(true);
    expect(canImpersonate('superadmin')).toBe(true);
    expect(canImpersonate('engineer')).toBe(false);
  });
});
