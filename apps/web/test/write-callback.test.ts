import { expect, it } from 'vitest';
import { completeConnection } from '../lib/connections/complete';
import type { PendingAuth } from '../lib/connections/pending';
import type { StoredToken } from '@nibbin/connectors';

const writeUpgradePending: PendingAuth = {
  state: 'st-write', provider: 'gmail', accountId: 'acc1', userId: 'usr1',
  codeVerifier: 'v',
  scopes: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.send',
  ],
  returnTo: '/app/nibbins/nib1?writeGranted=gmail',
  resumeTemplate: null,
  nibbinId: 'nib1',
  sweepConsent: false,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  consumedAt: null,
};

const token: StoredToken = {
  accessToken: 'AT', scopes: writeUpgradePending.scopes,
};

it('calls createWriteGrant dep when pending.nibbinId is set', async () => {
  const grantCalls: { pending: PendingAuth; connectionId: string }[] = [];
  const { redirectTo } = await completeConnection(
    { code: 'CODE', returnedState: 'st-write', nowMs: Date.now() },
    {
      consume: async () => writeUpgradePending,
      exchange: async () => token,
      createActiveConnection: async () => 'conn-new',
      createWriteGrant: async (p, connId) => { grantCalls.push({ pending: p, connectionId: connId }); },
    },
  );
  expect(grantCalls).toHaveLength(1);
  expect(grantCalls[0].pending.nibbinId).toBe('nib1');
  expect(grantCalls[0].connectionId).toBe('conn-new');
  expect(redirectTo).toBe('/app/nibbins/nib1?writeGranted=gmail');
});

it('does NOT call createWriteGrant when pending.nibbinId is null', async () => {
  const grantCalls: unknown[] = [];
  const readOnlyPending: PendingAuth = {
    ...writeUpgradePending, nibbinId: null,
    returnTo: '/app/connections',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  };
  await completeConnection(
    { code: 'CODE', returnedState: 'st-write', nowMs: Date.now() },
    {
      consume: async () => readOnlyPending,
      exchange: async () => ({ accessToken: 'AT', scopes: readOnlyPending.scopes }),
      createActiveConnection: async () => 'conn-ro',
      createWriteGrant: async (...args) => { grantCalls.push(args); },
    },
  );
  expect(grantCalls).toHaveLength(0);
});
