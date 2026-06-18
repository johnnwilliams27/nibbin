import { expect, it } from 'vitest';
import { completeConnection } from './complete';
import type { PendingAuth } from './pending';
import type { StoredToken } from '@nibbin/connectors';

const base: PendingAuth = {
  state: 's', provider: 'gmail', accountId: 'a', userId: 'u', codeVerifier: 'v',
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'], returnTo: '/app/connections',
  resumeTemplate: null, nibbinId: null, sweepConsent: false, expiresAt: new Date(99_999).toISOString(), consumedAt: null,
};
const token: StoredToken = { accessToken: 'at', scopes: base.scopes };

it('exchanges, creates the connection, and redirects to return_to', async () => {
  const created: StoredToken[] = [];
  const res = await completeConnection(
    { code: 'c', returnedState: 's', nowMs: 1 },
    {
      consume: async () => base,
      exchange: async () => token,
      createActiveConnection: async (_p, t) => { created.push(t); return 'conn1'; },
    },
  );
  expect(created).toHaveLength(1);
  expect(res.redirectTo).toBe('/app/connections?connected=gmail');
});

it('auto-resumes adoption and redirects to grove on success', async () => {
  const res = await completeConnection(
    { code: 'c', returnedState: 's', nowMs: 1 },
    {
      consume: async () => ({ ...base, resumeTemplate: 'scribe' }),
      exchange: async () => token,
      createActiveConnection: async () => 'conn1',
      resumeAdopt: async () => ({ ok: true, missing: [] }),
    },
  );
  expect(res.redirectTo).toBe('/app?adopted=scribe');
});

it('redirects to a friendly error when state is unknown/expired', async () => {
  const res = await completeConnection(
    { code: 'c', returnedState: 'gone', nowMs: 1 },
    { consume: async () => null, exchange: async () => token, createActiveConnection: async () => 'x' },
  );
  expect(res.redirectTo).toBe('/app/connections?error=expired');
});

it('exchange failure redirects with error=exchange_failed appended to returnTo', async () => {
  const res = await completeConnection(
    { code: 'c', returnedState: 's', nowMs: 1 },
    {
      consume: async () => base,
      exchange: async () => { throw new Error('bad token'); },
      createActiveConnection: async () => 'x',
    },
  );
  expect(res.redirectTo).toContain('error=exchange_failed');
  expect(res.redirectTo).toContain('/app/connections');
});

it('resume still missing redirects with needed and resume params', async () => {
  const res = await completeConnection(
    { code: 'c', returnedState: 's', nowMs: 1 },
    {
      consume: async () => ({ ...base, resumeTemplate: 'scribe' }),
      exchange: async () => token,
      createActiveConnection: async () => 'conn1',
      resumeAdopt: async () => ({ ok: false, missing: ['gmail'] }),
    },
  );
  expect(res.redirectTo).toContain('needed=gmail');
  expect(res.redirectTo).toContain('resume=scribe');
});
