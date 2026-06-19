import { describe, it, expect } from 'vitest';
import { clearbitUrl } from './ConnectorLogo';

describe('clearbitUrl', () => {
  it('builds a Clearbit logo URL from a domain', () => {
    expect(clearbitUrl('stripe.com')).toBe('https://logo.clearbit.com/stripe.com');
  });
});
