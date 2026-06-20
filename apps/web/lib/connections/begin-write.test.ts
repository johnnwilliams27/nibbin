import { expect, it } from 'vitest';
import { beginWriteConnect } from './begin-write';
import { makeTesterAllowlist } from './tester-allowlist';
import type { StorePendingInput } from './pending';

const config = {
  clientId: 'cid', clientSecret: 'sec',
  redirectUri: 'http://localhost:3000/api/connect/google/callback',
};

it('builds an incremental-consent Google URL with compose+send scopes', async () => {
  const saved: StorePendingInput[] = [];
  const res = await beginWriteConnect(
    {
      nibbinId: 'nib-abc', provider: 'gmail',
      accountId: 'acc1', userId: 'usr1', userEmail: 'john@gmail.com',
    },
    {
      config,
      allowlistFor: async () => makeTesterAllowlist(['john@gmail.com']),
      save: async (i) => { saved.push(i); },
      nowMs: 1000,
    },
  );
  const url = new URL(res.url);
  expect(url.searchParams.get('include_granted_scopes')).toBe('true');
  const scope = url.searchParams.get('scope') ?? '';
  expect(scope).toContain('gmail.compose');
  expect(scope).toContain('gmail.send');
  expect(saved[0].nibbinId).toBe('nib-abc');
});

it('stores returnTo defaulting to /app/nibbins/[id]?writeGranted=gmail', async () => {
  const saved: StorePendingInput[] = [];
  await beginWriteConnect(
    { nibbinId: 'nib-xyz', provider: 'gmail', accountId: 'a', userId: 'u', userEmail: 'john@gmail.com' },
    {
      config,
      allowlistFor: async () => makeTesterAllowlist(['john@gmail.com']),
      save: async (i) => { saved.push(i); },
      nowMs: 1000,
    },
  );
  expect(saved[0].returnTo).toBe('/app/nibbins/nib-xyz?writeGranted=gmail');
});

it('throws when nibbinId is empty', async () => {
  await expect(beginWriteConnect(
    { nibbinId: '', provider: 'gmail', accountId: 'a', userId: 'u', userEmail: 'john@gmail.com' },
    {
      config,
      allowlistFor: async () => makeTesterAllowlist(['john@gmail.com']),
      save: async () => {},
      nowMs: 1000,
    },
  )).rejects.toThrow();
});

it('throws when user is not on tester allowlist', async () => {
  await expect(beginWriteConnect(
    { nibbinId: 'nb1', provider: 'gmail', accountId: 'a', userId: 'u', userEmail: 'nope@gmail.com' },
    {
      config,
      allowlistFor: async () => makeTesterAllowlist(['john@gmail.com']),
      save: async () => {},
      nowMs: 1000,
    },
  )).rejects.toThrow();
});

it('provider-generic: derives calendar write scopes from the registry (no Gmail hardcode)', async () => {
  const saved: StorePendingInput[] = [];
  const res = await beginWriteConnect(
    { nibbinId: 'nib-cal', provider: 'google-calendar', accountId: 'a', userId: 'u', userEmail: 'john@gmail.com' },
    {
      config,
      allowlistFor: async () => makeTesterAllowlist(['john@gmail.com']),
      save: async (i) => { saved.push(i); },
      nowMs: 1000,
    },
  );
  const scope = new URL(res.url).searchParams.get('scope') ?? '';
  expect(scope).toContain('https://www.googleapis.com/auth/calendar.readonly');
  expect(scope).toContain('https://www.googleapis.com/auth/calendar.events');
  // No Gmail scopes leak into a calendar write upgrade.
  expect(scope).not.toContain('gmail');
  expect(saved[0].scopes).toContain('https://www.googleapis.com/auth/calendar.events');
});

it('uses supplied plainLanguageReason when provided', async () => {
  const saved: StorePendingInput[] = [];
  await beginWriteConnect(
    {
      nibbinId: 'nib-abc', provider: 'gmail',
      accountId: 'a', userId: 'u', userEmail: 'john@gmail.com',
      plainLanguageReason: 'Custom reason here.',
    },
    {
      config,
      allowlistFor: async () => makeTesterAllowlist(['john@gmail.com']),
      save: async (i) => { saved.push(i); },
      nowMs: 1000,
    },
  );
  expect(saved).toHaveLength(1);
});
