import { expect, it } from 'vitest';
import { storePending, consumePending, type StorePendingInput } from './pending';

interface FakeRow {
  state: string;
  provider: string;
  account_id: string;
  user_id: string;
  code_verifier: string | null;
  scopes: string[];
  return_to: string | null;
  resume_template: string | null;
  expires_at: string;
  consumed_at: string | null;
}

/** Fake SupabaseClient that models the atomic conditional-update chain used by consumePending:
 *  .update(patch).eq('state', state).is('consumed_at', null).gt('expires_at', nowIso).select('*').maybeSingle()
 *  Applies the update ONLY when the row exists, is not already consumed, and has not expired.
 */
function fakeSvc(rows: Record<string, FakeRow>) {
  return {
    from() {
      // Closure state accumulated through the chain
      let _patch: Partial<FakeRow> = {};
      let _state: string = '';
      let _isNull = false;
      let _gtIso: string = '';

      const chain = {
        insert: async (r: FakeRow) => {
          rows[r.state] = { ...r, consumed_at: null };
          return { error: null };
        },
        update(patch: Partial<FakeRow>) { _patch = patch; return chain; },
        select() { return chain; },
        eq(_col: string, v: string) { _state = v; return chain; },
        is(_col: string, _val: null) { _isNull = true; return chain; },
        gt(_col: string, v: string) { _gtIso = v; return chain; },
        async maybeSingle() {
          const row = rows[_state] ?? null;
          if (!row) return { data: null, error: null };
          // is('consumed_at', null) — reject if already consumed
          if (_isNull && row.consumed_at !== null) return { data: null, error: null };
          // gt('expires_at', nowIso) — reject if expired
          if (_gtIso && row.expires_at <= _gtIso) return { data: null, error: null };
          // Apply the update
          Object.assign(row, _patch);
          return { data: { ...row }, error: null };
        },
      };
      return chain;
    },
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

it('stores then consumes once; second consume returns null', async () => {
  const rows: Record<string, FakeRow> = {};
  const svc = fakeSvc(rows);
  await storePending({
    state: 's1', provider: 'gmail', accountId: 'a', userId: 'u',
    codeVerifier: 'v', scopes: ['x'], returnTo: '/app/connections', resumeTemplate: null,
    expiresAtMs: 10_000,
  }, svc);
  const first = await consumePending('s1', 5_000, svc);
  expect(first?.provider).toBe('gmail');
  const second = await consumePending('s1', 5_000, svc);
  expect(second).toBeNull();
});

it('returns null when expired', async () => {
  const rows: Record<string, FakeRow> = {};
  const svc = fakeSvc(rows);
  await storePending({
    state: 's2', provider: 'gmail', accountId: 'a', userId: 'u',
    scopes: ['x'], returnTo: null, resumeTemplate: null, expiresAtMs: 1_000,
  }, svc);
  expect(await consumePending('s2', 9_999, svc)).toBeNull();
});

it('StorePendingInput accepts nibbinId (compile-time check)', () => {
  const input: StorePendingInput = {
    state: 's', provider: 'gmail', accountId: 'a', userId: 'u',
    codeVerifier: 'v', scopes: [],
    returnTo: null, resumeTemplate: null, expiresAtMs: 9999,
    nibbinId: 'nb-uuid-1234',
  };
  expect(input.nibbinId).toBe('nb-uuid-1234');
});

it('consumePending maps nibbin_id column to nibbinId field', async () => {
  const row = {
    state: 'st1', provider: 'gmail', account_id: 'a1', user_id: 'u1',
    code_verifier: null, scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    return_to: null, resume_template: null,
    expires_at: new Date(Date.now() + 60000).toISOString(),
    consumed_at: new Date().toISOString(),
    nibbin_id: 'nb-0000-1234',
  };
  const svc = {
    from: () => ({
      update: () => ({ eq: () => ({ is: () => ({ gt: () => ({ select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) }) }),
    }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
  const result = await consumePending('st1', Date.now(), svc);
  expect(result?.nibbinId).toBe('nb-0000-1234');
});

it('consumePending maps nibbin_id = null to nibbinId = null', async () => {
  const row = {
    state: 'st2', provider: 'gmail', account_id: 'a2', user_id: 'u2',
    code_verifier: null, scopes: [],
    return_to: null, resume_template: null,
    expires_at: new Date(Date.now() + 60000).toISOString(),
    consumed_at: new Date().toISOString(),
    nibbin_id: null,
  };
  const svc = {
    from: () => ({
      update: () => ({ eq: () => ({ is: () => ({ gt: () => ({ select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) }) }),
    }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
  const result = await consumePending('st2', Date.now(), svc);
  expect(result?.nibbinId).toBeNull();
});
