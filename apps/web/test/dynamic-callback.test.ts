import { expect, it, describe } from 'vitest';
import { isWiredProvider } from '../lib/connections/callback-core';

describe('dynamic callback provider guard', () => {
  it('accepts a wired provider', () => {
    expect(isWiredProvider('google-calendar')).toBe(true);
  });
  it('rejects an unknown or un-wired provider', () => {
    expect(isWiredProvider('definitely-not-a-provider')).toBe(false);
  });
});
