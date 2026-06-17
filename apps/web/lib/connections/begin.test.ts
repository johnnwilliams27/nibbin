import { describe, expect, it, vi } from 'vitest';
import { beginConnect } from './begin';
import { makeTesterAllowlist } from './tester-allowlist';

const config = { clientId: 'cid', clientSecret: 'sec', redirectUri: 'http://localhost:3000/api/connect/google/callback' };

it('builds a Google authorization URL and persists pending state', async () => {
  const saved: any[] = [];
  const res = await beginConnect(
    { provider: 'gmail', accountId: 'a', userId: 'u', userEmail: 'john@gmail.com', returnTo: '/app/connections', resumeTemplate: 'scribe' },
    {
      config,
      allowlistFor: async () => makeTesterAllowlist(['john@gmail.com']),
      save: async (i) => { saved.push(i); },
      nowMs: 1000,
    },
  );
  const url = new URL(res.url);
  expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly');
  expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ provider: 'gmail', accountId: 'a', resumeTemplate: 'scribe', returnTo: '/app/connections' });
  expect(saved[0].state).toBe(url.searchParams.get('state'));
});

it('throws a friendly tester error when email is not allowlisted', async () => {
  await expect(beginConnect(
    { provider: 'gmail', accountId: 'a', userId: 'u', userEmail: 'nope@gmail.com' },
    { config, allowlistFor: async () => makeTesterAllowlist(['john@gmail.com']), save: async () => {}, nowMs: 1 },
  )).rejects.toThrow();
});
