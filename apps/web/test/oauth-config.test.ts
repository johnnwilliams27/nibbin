import { expect, it, describe, beforeEach } from 'vitest';
import { getOAuthConfigFor, callbackPathFor } from '../lib/connections/oauth-config';

describe('getOAuthConfigFor', () => {
  beforeEach(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'gid';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'gsecret';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://nibbin.com';
  });

  it('keeps Gmail on the legacy /google/ callback path', () => {
    expect(callbackPathFor('gmail')).toBe('google');
    expect(getOAuthConfigFor('gmail').redirectUri).toBe('https://nibbin.com/api/connect/google/callback');
  });

  it('google-calendar reuses the Google app creds but its own callback path', () => {
    const cfg = getOAuthConfigFor('google-calendar');
    expect(cfg.clientId).toBe('gid');
    expect(cfg.clientSecret).toBe('gsecret');
    expect(cfg.redirectUri).toBe('https://nibbin.com/api/connect/google-calendar/callback');
  });

  it('throws a clear error when creds are missing', () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    expect(() => getOAuthConfigFor('google-calendar')).toThrow(/GOOGLE_OAUTH_CLIENT_ID/);
  });
});
