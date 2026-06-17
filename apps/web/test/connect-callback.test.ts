import { expect, it } from 'vitest';
import { makeCreateActiveConnection } from '../app/api/connect/google/callback/route';
import type { PendingAuth } from '../lib/connections/pending';
import type { SupabaseClient } from '@supabase/supabase-js';

const pending: PendingAuth = {
  state: 's', provider: 'gmail', accountId: 'a', userId: 'u', codeVerifier: 'v',
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'], returnTo: '/app/connections',
  resumeTemplate: null, expiresAt: new Date(Date.now() + 60000).toISOString(), consumedAt: null,
};

interface FakeCalls {
  insert: Record<string, unknown> | null;
  rpc: { name: string; params: Record<string, unknown> } | null;
}

it('makeCreateActiveConnection inserts an active connection and stores the token via the vault RPC', async () => {
  const calls: FakeCalls = { insert: null, rpc: null };
  const svc = {
    from: () => ({ insert: (r: Record<string, unknown>) => ({ select: () => ({ single: async () => { calls.insert = r; return { data: { id: 'conn1' }, error: null }; } }) }) }),
    rpc: async (name: string, params: Record<string, unknown>) => { calls.rpc = { name, params }; return { data: '"ref"', error: null }; },
  } as unknown as SupabaseClient;
  const create = makeCreateActiveConnection(svc);
  const id = await create(pending, { accessToken: 'AT', scopes: pending.scopes });
  expect(id).toBe('conn1');
  expect(calls.insert).toMatchObject({ account_id: 'a', provider: 'gmail', method: 'H', status: 'active' });
  expect(calls.rpc).toMatchObject({ name: 'connection_token_store', params: { p_connection: 'conn1' } });
});
