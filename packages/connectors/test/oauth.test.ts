/**
 * OAuth engine — C8 by construction: first connects are read-only, write
 * scopes only via the per-Nibbin upgrade path, Google connects gated to the
 * tester allowlist while verification is pending.
 */
import { describe, it, expect } from 'vitest';
import { codeChallengeS256, generateCodeVerifier, generateState, timingSafeEqualString } from '../src/oauth/pkce';
import {
  beginAuthorization,
  beginWriteScopeUpgrade,
  exchangeCode,
  enforcePlatformGate,
  OAuthFlowError,
  type TesterAllowlist,
  type PlatformGateRequest,
} from '../src/oauth/flow';
import { getConnector } from '../src/registry/registry';

const allow = (emails: string[], count = emails.length): TesterAllowlist => ({
  isAllowed: (e) => emails.includes(e),
  count: () => count,
});

const GMAIL_BASE = {
  provider: 'gmail',
  clientId: 'client-123',
  redirectUri: 'https://app.nibbin.com/connect/callback',
  tester: { email: 'john@example.test', allowlist: allow(['john@example.test']) },
};

describe('PKCE primitives (§6.5)', () => {
  it('produces RFC 7636 S256 challenges (appendix B vector)', () => {
    expect(codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('verifiers and state are unique, url-safe, and long enough', () => {
    const v = generateCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(generateCodeVerifier()).not.toBe(v);
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('timing-safe compare', () => {
    expect(timingSafeEqualString('abc', 'abc')).toBe(true);
    expect(timingSafeEqualString('abc', 'abd')).toBe(false);
    expect(timingSafeEqualString('abc', 'abcd')).toBe(false);
  });
});

describe('first connect is read-only (C8)', () => {
  it('requests exactly the descriptor read scopes — write scopes never appear', () => {
    const pending = beginAuthorization(GMAIL_BASE);
    const url = new URL(pending.url);
    const scope = url.searchParams.get('scope')!;
    expect(scope).toBe('https://www.googleapis.com/auth/gmail.readonly');
    expect(scope).not.toContain('gmail.send');
    expect(scope).not.toContain('gmail.compose');
    expect(pending.scopes).toEqual(getConnector('gmail').scopes.read);
  });

  it('carries state, PKCE S256, and offline access for Google — no dead nonce', () => {
    const pending = beginAuthorization(GMAIL_BASE);
    const url = new URL(pending.url);
    expect(url.searchParams.get('state')).toBe(pending.state);
    expect(url.searchParams.has('nonce')).toBe(false);
    expect(url.searchParams.get('code_challenge')).toBe(codeChallengeS256(pending.codeVerifier!));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
  });

  it('stripe uses the platform-level read_only scope', () => {
    const pending = beginAuthorization({ provider: 'stripe', clientId: 'ca_x', redirectUri: 'https://app.nibbin.com/cb' });
    expect(new URL(pending.url).searchParams.get('scope')).toBe('read_only');
  });

  it('refuses non-OAuth providers (rails, aggregator)', () => {
    expect(() => beginAuthorization({ provider: 'generic-mcp', clientId: 'x', redirectUri: 'https://x' })).toThrow(
      OAuthFlowError,
    );
  });
});

describe('Google pending-verification gate (docs/STATE.md, RISKS §1)', () => {
  it('requires a tester while verification is pending', () => {
    expect(() => beginAuthorization({ ...GMAIL_BASE, tester: undefined })).toThrowError(/tester-required/);
  });

  it('rejects emails not on the allowlist', () => {
    expect(() =>
      beginAuthorization({ ...GMAIL_BASE, tester: { email: 'evil@example.test', allowlist: allow(['john@example.test']) } }),
    ).toThrowError(/tester-not-allowed/);
  });

  it('enforces the 100-user unverified cap', () => {
    expect(() =>
      beginAuthorization({ ...GMAIL_BASE, tester: { email: 'john@example.test', allowlist: allow(['john@example.test'], 100) } }),
    ).toThrowError(/tester-cap-reached/);
  });
});

describe('per-Nibbin write-scope upgrade (C8 incremental consent)', () => {
  const upgrade = {
    ...GMAIL_BASE,
    nibbinId: 'nibbin-echo-1',
    scopes: ['https://www.googleapis.com/auth/gmail.compose'],
    plainLanguageReason: 'Echo drafts replies to overdue threads for your approval.',
  };

  it('requests read + the granted write scopes with incremental consent', () => {
    const pending = beginWriteScopeUpgrade(upgrade);
    const url = new URL(pending.url);
    const scopes = url.searchParams.get('scope')!.split(' ');
    expect(scopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(scopes).toContain('https://www.googleapis.com/auth/gmail.compose');
    expect(scopes).not.toContain('https://www.googleapis.com/auth/gmail.send');
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
  });

  it('demands the adopting Nibbin id', () => {
    expect(() => beginWriteScopeUpgrade({ ...upgrade, nibbinId: '  ' })).toThrowError(/invalid-write-request/);
  });

  it('demands a plain-language reason', () => {
    expect(() => beginWriteScopeUpgrade({ ...upgrade, plainLanguageReason: 'send' })).toThrowError(
      /plain-language/,
    );
  });

  it('only declared write scopes can be requested', () => {
    expect(() =>
      beginWriteScopeUpgrade({ ...upgrade, scopes: ['https://mail.google.com/'] }),
    ).toThrowError(/not a declared write scope/);
    expect(() => beginWriteScopeUpgrade({ ...upgrade, scopes: [] })).toThrowError(/no write scopes/);
  });
});

describe('code exchange', () => {
  it('rejects state mismatches before any network I/O', async () => {
    await expect(
      exchangeCode({
        provider: 'gmail',
        code: 'code',
        redirectUri: 'https://app.nibbin.com/cb',
        clientId: 'c',
        clientSecret: 's',
        expectedState: 'issued-state',
        returnedState: 'attacker-state',
        requestedScopes: [],
      }),
    ).rejects.toThrowError(/state-mismatch/);
  });
});

describe('enforcePlatformGate — standalone export (Task 8)', () => {
  const gmailDescriptor = getConnector('gmail');
  const allowedList: TesterAllowlist = { isAllowed: () => true, count: () => 0 };
  const blockedList: TesterAllowlist = { isAllowed: () => false, count: () => 0 };
  const fullCap: TesterAllowlist = { isAllowed: () => true, count: () => 100 };

  it('is exported as a named function (not private)', () => {
    expect(typeof enforcePlatformGate).toBe('function');
  });

  it('throws tester-required for pending provider when no tester provided', () => {
    const req: PlatformGateRequest = { provider: 'gmail' };
    expect(() => enforcePlatformGate(gmailDescriptor, req)).toThrowError(/tester-required/);
  });

  it('throws tester-not-allowed when email is not on allowlist', () => {
    const req: PlatformGateRequest = {
      provider: 'gmail',
      tester: { email: 'evil@example.com', allowlist: blockedList },
    };
    expect(() => enforcePlatformGate(gmailDescriptor, req)).toThrowError(/tester-not-allowed/);
  });

  it('throws tester-cap-reached when cap is at 100', () => {
    const req: PlatformGateRequest = {
      provider: 'gmail',
      tester: { email: 'john@example.com', allowlist: fullCap },
    };
    expect(() => enforcePlatformGate(gmailDescriptor, req)).toThrowError(/tester-cap-reached/);
  });

  it('does not throw when tester is on allowlist and under cap', () => {
    const req: PlatformGateRequest = {
      provider: 'gmail',
      tester: { email: 'john@example.com', allowlist: allowedList },
    };
    expect(() => enforcePlatformGate(gmailDescriptor, req)).not.toThrow();
  });

  it('accepts a narrower PlatformGateRequest without clientId or redirectUri', () => {
    // This is the type-friction fix: [N] call sites should not need to pass empty strings
    const req: PlatformGateRequest = {
      provider: 'gmail',
      tester: { email: 'john@example.com', allowlist: allowedList },
    };
    // TypeScript should accept this without requiring clientId/redirectUri
    expect(() => enforcePlatformGate(gmailDescriptor, req)).not.toThrow();
  });
});
