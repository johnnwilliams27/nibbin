import { describe, expect, it } from 'vitest';
import { makeTesterAllowlist } from './tester-allowlist';

describe('makeTesterAllowlist', () => {
  it('gates on normalized allowlist membership', () => {
    const a = makeTesterAllowlist(['john@gmail.com', 'amy@gmail.com'], 0);
    expect(a.isAllowed('John@Gmail.com')).toBe(true);
    expect(a.isAllowed('nobody@gmail.com')).toBe(false);
  });

  it('count() reflects consented users, not allowlist rows', () => {
    // Two allowlisted testers but only one has actually connected.
    const a = makeTesterAllowlist(['john@gmail.com', 'amy@gmail.com'], 1);
    expect(a.count()).toBe(1);
  });

  it('defaults the consented-user count to 0 when none have connected', () => {
    const a = makeTesterAllowlist(['john@gmail.com']);
    expect(a.count()).toBe(0);
  });
});
