import { describe, expect, it, vi } from 'vitest';
import { completeConnection } from './complete';
import type { PendingAuth } from './pending';

const base: PendingAuth = {
  state: 's', provider: 'gmail', accountId: 'a', userId: 'u', codeVerifier: 'v',
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'], returnTo: '/app/connections',
  resumeTemplate: null, expiresAt: new Date(99_999).toISOString(), consumedAt: null,
};
const token = { accessToken: 'at', scopes: base.scopes };

it('exchanges, creates the connection, and redirects to return_to', async () => {
  const created: any[] = [];
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
