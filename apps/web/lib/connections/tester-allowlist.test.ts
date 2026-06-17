import { describe, expect, it } from 'vitest';
import { makeTesterAllowlist } from './tester-allowlist';

describe('makeTesterAllowlist', () => {
  it('allows a normalized email present in the loaded set and counts distinct testers', () => {
    const a = makeTesterAllowlist(['john@gmail.com', 'amy@gmail.com']);
    expect(a.isAllowed('John@Gmail.com')).toBe(true);
    expect(a.isAllowed('nobody@gmail.com')).toBe(false);
    expect(a.count()).toBe(2);
  });
});
