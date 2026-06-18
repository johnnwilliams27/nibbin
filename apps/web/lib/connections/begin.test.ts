import { expect, it } from 'vitest';
import { beginConnect } from './begin';
import { makeTesterAllowlist } from './tester-allowlist';
import type { StorePendingInput } from './pending';

const config = { clientId: 'cid', clientSecret: 'sec', redirectUri: 'http://localhost:3000/api/connect/google/callback' };

it('builds a Google authorization URL and persists pending state', async () => {
  const saved: StorePendingInput[] = [];
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

it('forwards sweepConsent into the saved pending row', async () => {
  const saved: StorePendingInput[] = [];
  await beginConnect(
    { provider: 'gmail', accountId: 'a', userId: 'u', userEmail: 'john@gmail.com', sweepConsent: true },
    { config, allowlistFor: async () => makeTesterAllowlist(['john@gmail.com']), save: async (i) => { saved.push(i); }, nowMs: 0 },
  );
  expect(saved[0].sweepConsent).toBe(true);
});

it('safeReturnTo: absolute/protocol-relative URLs are dropped; /app/ paths are preserved', async () => {
  // evil absolute URL — must be dropped (saved row's returnTo should be null)
  const savedEvil: StorePendingInput[] = [];
  await beginConnect(
    { provider: 'gmail', accountId: 'a', userId: 'u', userEmail: 'john@gmail.com', returnTo: 'https://evil.com/x' },
    { config, allowlistFor: async () => makeTesterAllowlist(['john@gmail.com']), save: async (i) => { savedEvil.push(i); }, nowMs: 1000 },
  );
  expect(savedEvil[0].returnTo).toBeNull();

  // protocol-relative URL — must also be dropped
  const savedProto: StorePendingInput[] = [];
  await beginConnect(
    { provider: 'gmail', accountId: 'a', userId: 'u', userEmail: 'john@gmail.com', returnTo: '//evil.com' },
    { config, allowlistFor: async () => makeTesterAllowlist(['john@gmail.com']), save: async (i) => { savedProto.push(i); }, nowMs: 1000 },
  );
  expect(savedProto[0].returnTo).toBeNull();

  // safe /app/ path — must be preserved
  const savedSafe: StorePendingInput[] = [];
  await beginConnect(
    { provider: 'gmail', accountId: 'a', userId: 'u', userEmail: 'john@gmail.com', returnTo: '/app/connections' },
    { config, allowlistFor: async () => makeTesterAllowlist(['john@gmail.com']), save: async (i) => { savedSafe.push(i); }, nowMs: 1000 },
  );
  expect(savedSafe[0].returnTo).toBe('/app/connections');
});
