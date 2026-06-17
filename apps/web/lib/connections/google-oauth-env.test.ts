import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGoogleOAuthConfig } from './google-oauth-env';

afterEach(() => vi.unstubAllEnvs());

describe('getGoogleOAuthConfig', () => {
  it('builds the redirect URI from the site origin and returns creds', () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'cid');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'secret');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
    expect(getGoogleOAuthConfig()).toEqual({
      clientId: 'cid',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/api/connect/google/callback',
    });
  });

  it('throws when creds are missing', () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', '');
    expect(() => getGoogleOAuthConfig()).toThrow(/GOOGLE_OAUTH_CLIENT_ID/);
  });
});
