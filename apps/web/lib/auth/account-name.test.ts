import { describe, it, expect } from 'vitest';
import { defaultAccountName } from './account-name';

describe('defaultAccountName (first-sign-in default; real naming is M2)', () => {
  it('uses the email local-part', () => {
    expect(defaultAccountName('john.smith@example.com')).toBe('john.smith');
  });

  it('preserves case', () => {
    expect(defaultAccountName('Penny@studio.co')).toBe('Penny');
  });

  it('strips a +tag suffix', () => {
    expect(defaultAccountName('a+newsletter@x.com')).toBe('a');
  });

  it('trims surrounding whitespace', () => {
    expect(defaultAccountName('  ws@x.com  ')).toBe('ws');
  });

  it('falls back to "My grove" when there is no usable local-part', () => {
    expect(defaultAccountName('@x.com')).toBe('My grove');
    expect(defaultAccountName('   ')).toBe('My grove');
    expect(defaultAccountName('')).toBe('My grove');
  });

  it('handles a bare token with no @ as the name itself', () => {
    expect(defaultAccountName('solo')).toBe('solo');
  });

  it('never returns a blank or over-long name (DB requires non-blank)', () => {
    const long = 'x'.repeat(200) + '@x.com';
    const out = defaultAccountName(long);
    expect(out.trim()).not.toBe('');
    expect(out.length).toBeLessThanOrEqual(80);
  });
});
