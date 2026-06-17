import { describe, expect, it } from 'vitest';
import { storePending, consumePending, type PendingAuth } from './pending';

function fakeSvc(rows: Record<string, any>) {
  return {
    from() {
      return {
        insert: async (r: any) => { rows[r.state] = { ...r, consumed_at: null }; return { error: null }; },
        select() { return this; },
        eq(_c: string, v: string) { this._k = v; return this; },
        async maybeSingle() { return { data: rows[(this as any)._k] ?? null, error: null }; },
        update(patch: any) { this._patch = patch; return this; },
      } as any;
    },
  } as any;
}

describe('pending store/consume', () => {
  it('stores then consumes once; second consume returns null', async () => {
    const rows: Record<string, any> = {};
    const svc = fakeSvc(rows);
    await storePending({
      state: 's1', provider: 'gmail', accountId: 'a', userId: 'u', nonce: 'n',
      codeVerifier: 'v', scopes: ['x'], returnTo: '/app/connections', resumeTemplate: null,
      expiresAtMs: 10_000,
    }, svc);
    const first = await consumePending('s1', 5_000, svc);
    expect(first?.provider).toBe('gmail');
    rows['s1'].consumed_at = '2026-06-17T00:00:00Z'; // simulate the consume write
    const second = await consumePending('s1', 5_000, svc);
    expect(second).toBeNull();
  });

  it('returns null when expired', async () => {
    const rows: Record<string, any> = {};
    const svc = fakeSvc(rows);
    await storePending({
      state: 's2', provider: 'gmail', accountId: 'a', userId: 'u', nonce: 'n',
      scopes: ['x'], returnTo: null, resumeTemplate: null, expiresAtMs: 1_000,
    }, svc);
    expect(await consumePending('s2', 9_999, svc)).toBeNull();
  });
});
