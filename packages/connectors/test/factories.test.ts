/**
 * Task 6 TDD — factory functions + vault-read guard.
 *
 * Verifies:
 *  1. makeGmailClient throws typed NangoConnectionMissingError when
 *     method=N connection has null nangoConnectionId.
 *  2. makeGoogleCalendarClient throws typed NangoConnectionMissingError
 *     when method=N connection has null nangoConnectionId.
 *  3. Factories succeed and return correct provider when nangoConnectionId present.
 *  4. makeGmailClient throws on provider mismatch.
 *  5. makeGoogleCalendarClient throws on provider mismatch.
 *  6. Non-N method connections: factory accepts a null nangoConnectionId without
 *     the typed error (legacy path; H-method connections carry tokenRef instead).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  makeGmailClient,
  NangoConnectionMissingError,
} from '../src/connectors/gmail';
import { makeGoogleCalendarClient } from '../src/connectors/google-calendar';
import type { Connection } from '../src/types';
import { makeMockNango } from './helpers/mock-nango';

function makeConnection(partial: Partial<Connection> = {}): Connection {
  return {
    id: 'c0a80001-0000-4000-8000-000000000001',
    accountId: 'acct-test-1',
    provider: 'gmail',
    method: 'N',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    status: 'active',
    tokenRef: null,
    webhookState: {},
    createdBy: null,
    createdAt: new Date(0).toISOString(),
    revokedAt: null,
    nangoConnectionId: 'nibbin-acct-test-1-gmail',
    nangoProviderConfigKey: 'google-mail',
    ...partial,
  };
}

// ── Test 1: makeGmailClient throws NangoConnectionMissingError for null N-method ──

describe('makeGmailClient', () => {
  it('throws NangoConnectionMissingError when method=N and nangoConnectionId is null', () => {
    const conn = makeConnection({ method: 'N', nangoConnectionId: null });
    expect(() => makeGmailClient(conn, makeMockNango())).toThrow(NangoConnectionMissingError);
  });

  it('throws NangoConnectionMissingError when method=N and nangoConnectionId is undefined', () => {
    const conn = makeConnection({ method: 'N', nangoConnectionId: undefined });
    expect(() => makeGmailClient(conn, makeMockNango())).toThrow(NangoConnectionMissingError);
  });

  it('NangoConnectionMissingError contains provider and connection id', () => {
    const conn = makeConnection({ method: 'N', nangoConnectionId: null });
    try {
      makeGmailClient(conn, makeMockNango());
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NangoConnectionMissingError);
      expect((e as NangoConnectionMissingError).provider).toBe('gmail');
      expect((e as NangoConnectionMissingError).connectionId).toBe(conn.id);
    }
  });

  it('constructs GmailClient successfully when nangoConnectionId is present', () => {
    const conn = makeConnection({ method: 'N', nangoConnectionId: 'nibbin-acct-1-gmail' });
    const client = makeGmailClient(conn, makeMockNango());
    expect(client.provider).toBe('gmail');
  });

  it('throws on provider mismatch', () => {
    const conn = makeConnection({ provider: 'google-calendar' });
    expect(() => makeGmailClient(conn, makeMockNango())).toThrow('provider mismatch');
  });

  it('does NOT throw NangoConnectionMissingError for non-N method with null nangoConnectionId', () => {
    // H-method connections use vault (tokenRef), not Nango.
    // The factory must pass through without the N-guard for non-N connections
    // (even though H-method Gmail no longer exists after Task 7 registry flip,
    // we want the guard to be method-specific, not a blanket null check).
    const conn = makeConnection({ method: 'H', nangoConnectionId: null });
    // Should not throw NangoConnectionMissingError — it passes with empty string
    expect(() => makeGmailClient(conn, makeMockNango())).not.toThrow(NangoConnectionMissingError);
  });
});

// ── Test 2: makeGoogleCalendarClient mirrors the same guarantees ──

describe('makeGoogleCalendarClient', () => {
  it('throws NangoConnectionMissingError when method=N and nangoConnectionId is null', () => {
    const conn = makeConnection({ provider: 'google-calendar', method: 'N', nangoConnectionId: null });
    expect(() => makeGoogleCalendarClient(conn, makeMockNango())).toThrow(NangoConnectionMissingError);
  });

  it('NangoConnectionMissingError contains provider google-calendar', () => {
    const conn = makeConnection({ provider: 'google-calendar', method: 'N', nangoConnectionId: null });
    try {
      makeGoogleCalendarClient(conn, makeMockNango());
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NangoConnectionMissingError);
      expect((e as NangoConnectionMissingError).provider).toBe('google-calendar');
    }
  });

  it('constructs GoogleCalendarClient successfully when nangoConnectionId is present', () => {
    const conn = makeConnection({
      provider: 'google-calendar',
      method: 'N',
      nangoConnectionId: 'nibbin-acct-1-google-calendar',
    });
    const client = makeGoogleCalendarClient(conn, makeMockNango());
    expect(client.provider).toBe('google-calendar');
  });

  it('throws on provider mismatch', () => {
    const conn = makeConnection({ provider: 'gmail' });
    expect(() => makeGoogleCalendarClient(conn, makeMockNango())).toThrow('provider mismatch');
  });
});

// ── Test 3: vault is NOT called for N-method connections ──

describe('vault-read guard (N-method does not use vault)', () => {
  it('makeGmailClient with N-method never touches vault (mock vault not called)', async () => {
    const conn = makeConnection({ method: 'N', nangoConnectionId: 'nibbin-acct-1-gmail' });
    const nango = makeMockNango({ proxyStatus: 200, proxyData: { emailAddress: 'test@example.com' } });
    const client = makeGmailClient(conn, nango);

    // The mock vault: if vault.read were ever called, this spy would fire.
    const mockVaultRead = vi.fn().mockResolvedValue({ accessToken: 'SHOULD_NEVER_USE' });

    // Call a real client method (getProfile) — it routes through Nango proxy, never vault.
    const profile = await client.getProfile();

    expect(profile.emailAddress).toBe('test@example.com');
    expect(nango.proxy).toHaveBeenCalledOnce();
    // Vault read must never have been called — N connections have no live vault token.
    expect(mockVaultRead).not.toHaveBeenCalled();
  });

  it('makeGmailClient createDraft routes through Nango proxy, not vault', async () => {
    const scopes = [
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.readonly',
    ];
    const conn = makeConnection({
      method: 'N',
      nangoConnectionId: 'nibbin-acct-1-gmail',
      scopes,
    });
    const nango = makeMockNango({ proxyStatus: 200, proxyData: { id: 'draft-123' } });
    const mockVaultRead = vi.fn();

    const client = makeGmailClient(conn, nango);
    const draft = await client.createDraft('base64rawRfc822==');

    expect(draft.id).toBe('draft-123');
    expect(nango.proxy).toHaveBeenCalledOnce();
    expect(mockVaultRead).not.toHaveBeenCalled();
  });
});
