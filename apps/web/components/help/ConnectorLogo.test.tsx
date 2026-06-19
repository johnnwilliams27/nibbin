import { describe, it, expect } from 'vitest';
import { logoUrl } from './ConnectorLogo';

describe('logoUrl', () => {
  it('builds a same-origin proxy URL from a domain', () => {
    expect(logoUrl('stripe.com')).toBe('/api/connector-logo?domain=stripe.com');
  });
  it('url-encodes the domain', () => {
    expect(logoUrl('a b.com')).toBe('/api/connector-logo?domain=a%20b.com');
  });
});
