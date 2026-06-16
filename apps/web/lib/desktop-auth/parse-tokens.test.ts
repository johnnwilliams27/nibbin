import { describe, it, expect } from 'vitest';
import { parseTokens } from './parse-tokens';

describe('parseTokens', () => {
  it('extracts both tokens from a fragment', () => {
    expect(parseTokens('#access_token=a&refresh_token=r')).toEqual({
      access_token: 'a',
      refresh_token: 'r',
    });
  });

  it('works without the leading hash', () => {
    expect(parseTokens('access_token=a&refresh_token=r')).toEqual({
      access_token: 'a',
      refresh_token: 'r',
    });
  });

  it('returns null when a token is missing', () => {
    expect(parseTokens('#access_token=a')).toBeNull();
    expect(parseTokens('#refresh_token=r')).toBeNull();
    expect(parseTokens('')).toBeNull();
  });
});
