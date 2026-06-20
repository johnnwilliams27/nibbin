import { expect, it, describe } from 'vitest';
import { isWiredProvider } from '../lib/connections/callback-core';
import { completeConnection } from '../lib/connections/complete';
import type { PendingAuth } from '../lib/connections/pending';

describe('dynamic callback provider guard', () => {
  it('accepts a wired provider', () => {
    expect(isWiredProvider('google-calendar')).toBe(true);
  });
  it('rejects an unknown or un-wired provider', () => {
    expect(isWiredProvider('definitely-not-a-provider')).toBe(false);
  });
});

/**
 * expectedProvider mismatch guard (Fix 5).
 *
 * handleConnectionCallback's consume closure returns null when
 * pending.provider !== opts.expectedProvider, which completeConnection
 * treats as an expired/consumed pending → redirects to ?error=expired.
 * No token exchange or connection insert should occur.
 *
 * We test at the completeConnection layer (which is the actual guard
 * outcome) to avoid pulling in server-only imports. The closure logic
 * `if (p && opts.expectedProvider && p.provider !== opts.expectedProvider) return null`
 * is a 1-line guard in handleConnectionCallback; here we assert the full
 * downstream effect: consume returning null → expired redirect, no exchange,
 * no insert.
 */
describe('expectedProvider mismatch: redirects to expired, no token exchange or insert', () => {
  const calendarPending: PendingAuth = {
    state: 'st-cal',
    provider: 'google-calendar',
    accountId: 'acc1',
    userId: 'usr1',
    codeVerifier: 'cv',
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    returnTo: '/app/connections',
    resumeTemplate: null,
    nibbinId: null,
    sweepConsent: false,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    consumedAt: null,
  };

  it('returns ?error=expired redirect when consume returns null (provider mismatch guard fires)', async () => {
    const exchangeCalls: unknown[] = [];
    const insertCalls: unknown[] = [];

    // Simulate the guard: expectedProvider='gmail' but pending.provider='google-calendar'
    // → closure returns null, exactly as handleConnectionCallback does.
    const { redirectTo } = await completeConnection(
      { code: 'CODE', returnedState: 'st-cal', nowMs: Date.now() },
      {
        // The guard in handleConnectionCallback: mismatched provider → consume returns null.
        consume: async (_state, _now) => {
          const p = calendarPending;
          const expectedProvider = 'gmail';
          if (p && p.provider !== expectedProvider) return null;
          return p;
        },
        exchange: async (...args) => { exchangeCalls.push(args); return { accessToken: 'AT', scopes: [] }; },
        createActiveConnection: async (...args) => { insertCalls.push(args); return 'conn1'; },
      },
    );

    expect(redirectTo).toContain('?error=expired');
    expect(exchangeCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });

  it('does NOT redirect to expired when provider matches expectedProvider', async () => {
    const { redirectTo } = await completeConnection(
      { code: 'CODE', returnedState: 'st-cal', nowMs: Date.now() },
      {
        consume: async (_state, _now) => {
          const p = calendarPending;
          const expectedProvider = 'google-calendar';
          if (p && p.provider !== expectedProvider) return null;
          return p;
        },
        exchange: async () => ({ accessToken: 'AT', scopes: [] }),
        createActiveConnection: async () => 'conn2',
      },
    );

    expect(redirectTo).not.toContain('error=expired');
    expect(redirectTo).toContain('connected=google-calendar');
  });
});
