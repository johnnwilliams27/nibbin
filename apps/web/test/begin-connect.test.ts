import { expect, it, describe, beforeEach } from 'vitest';
import { beginConnect } from '../lib/connections/begin';
import { getOAuthConfigFor } from '../lib/connections/oauth-config';
import { makeTesterAllowlist } from '../lib/connections/tester-allowlist';

describe('beginConnect per-provider redirect', () => {
  beforeEach(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'gid';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'gsecret';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://nibbin.com';
  });

  it('builds the Google Calendar authorize URL with the calendar callback redirect_uri', async () => {
    const saved: unknown[] = [];
    const { url } = await beginConnect(
      { provider: 'google-calendar', accountId: 'a', userId: 'u', userEmail: 'x@y.z' },
      {
        config: getOAuthConfigFor('google-calendar'),
        allowlistFor: async () => makeTesterAllowlist(['x@y.z']),
        save: async (i) => { saved.push(i); },
        nowMs: 1_700_000_000_000,
      },
    );
    expect(url).toContain(encodeURIComponent('https://nibbin.com/api/connect/google-calendar/callback'));
    expect((saved[0] as { provider: string }).provider).toBe('google-calendar');
    // Connector Lever 1: connect requests read + write scopes in one consent.
    expect(url).toContain(encodeURIComponent('calendar.readonly'));
    expect(url).toContain(encodeURIComponent('calendar.events'));
  });
});
