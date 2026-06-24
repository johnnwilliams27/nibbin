/**
 * NangoConnectorClient — Task 2 TDD tests.
 *
 * Verifies:
 *  - connection-state guard (revoked connections unusable)
 *  - egress allowlist re-check BEFORE any proxy call (security-critical)
 *  - 401/403 → 'auth' error
 *  - 429 → 'rate-limit' error
 *  - successful read() returns QuarantinedContent
 *  - readJson() returns parsed data + QuarantinedContent
 */
import { describe, it, expect } from 'vitest';
import { NangoConnectorClient } from '../src/connectors/nango-base';
import { isQuarantined } from '../src/quarantine';
import type { Connection } from '../src/types';
import { makeMockNango } from './helpers/mock-nango';

function makeConnection(partial: Partial<Connection> = {}): Connection {
  return {
    id: 'c0a80001-0000-4000-8000-000000000099',
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
    ...partial,
  };
}

describe('NangoConnectorClient', () => {
  // ── a. Active-connection guard ──────────────────────────────────────────────

  it('throws connection-state error when connection is revoked', async () => {
    const conn = makeConnection({ status: 'revoked', provider: 'gmail' });
    const client = new NangoConnectorClient(conn, makeMockNango(), 'google-mail', 'nango-conn-id-1');
    await expect(client.read('/gmail/v1/users/me/profile')).rejects.toMatchObject({ kind: 'connection-state' });
  });

  it('throws connection-state error when connection is paused', async () => {
    const conn = makeConnection({ status: 'paused', provider: 'gmail' });
    const client = new NangoConnectorClient(conn, makeMockNango(), 'google-mail', 'nango-conn-id-1');
    await expect(client.read('/test')).rejects.toMatchObject({ kind: 'connection-state' });
  });

  // ── b. Egress allowlist re-check ────────────────────────────────────────────

  it('throws egress error and does NOT call proxy when host is outside the allowlist', async () => {
    const conn = makeConnection({ status: 'active', provider: 'gmail' });
    const mock = makeMockNango();
    const client = new NangoConnectorClient(conn, mock, 'google-mail', 'nango-conn-id-1');
    // Pass an absolute URL targeting a host not in gmail's egressAllowlist
    await expect(
      client.read('https://evil.com/steal-data'),
    ).rejects.toMatchObject({ kind: 'egress' });
    expect(mock.proxy).not.toHaveBeenCalled();
  });

  it('allows a host that matches the gmail egress allowlist', async () => {
    const conn = makeConnection({ status: 'active', provider: 'gmail' });
    const mock = makeMockNango({ proxyStatus: 200, proxyData: { emailAddress: 'user@example.com' } });
    const client = new NangoConnectorClient(conn, mock, 'google-mail', 'nango-conn-id-1');
    // gmail.googleapis.com is in the allowlist
    await expect(
      client.read('https://gmail.googleapis.com/gmail/v1/users/me/profile'),
    ).resolves.toBeDefined();
    expect(mock.proxy).toHaveBeenCalledOnce();
  });

  it('allows relative paths (uses first allowlist entry as canonical base)', async () => {
    const conn = makeConnection({ status: 'active', provider: 'gmail' });
    const mock = makeMockNango({ proxyStatus: 200, proxyData: {} });
    const client = new NangoConnectorClient(conn, mock, 'google-mail', 'nango-conn-id-1');
    // Relative paths do not have a host — they use the canonical allowlist host
    await expect(client.read('/gmail/v1/users/me/profile')).resolves.toBeDefined();
    expect(mock.proxy).toHaveBeenCalledOnce();
  });

  // ── c. 401 from proxy → ConnectorRequestError 'auth' ───────────────────────

  it('throws auth error on proxy 401', async () => {
    const conn = makeConnection({ status: 'active', provider: 'gmail' });
    const mock = makeMockNango({ proxyStatus: 401, proxyData: { error: 'Unauthorized' } });
    const client = new NangoConnectorClient(conn, mock, 'google-mail', 'nango-conn-id-1');
    await expect(client.read('/gmail/v1/users/me/profile')).rejects.toMatchObject({
      kind: 'auth',
      status: 401,
    });
  });

  it('throws auth error on proxy 403', async () => {
    const conn = makeConnection({ status: 'active', provider: 'gmail' });
    const mock = makeMockNango({ proxyStatus: 403, proxyData: { error: 'Forbidden' } });
    const client = new NangoConnectorClient(conn, mock, 'google-mail', 'nango-conn-id-1');
    await expect(client.read('/gmail/v1/users/me/profile')).rejects.toMatchObject({
      kind: 'auth',
      status: 403,
    });
  });

  // ── d. 429 → ConnectorRequestError 'rate-limit' ─────────────────────────────

  it('throws rate-limit error on proxy 429', async () => {
    const conn = makeConnection({ status: 'active', provider: 'gmail' });
    const mock = makeMockNango({ proxyStatus: 429, proxyData: { error: 'Too Many Requests' } });
    const client = new NangoConnectorClient(conn, mock, 'google-mail', 'nango-conn-id-1');
    await expect(client.read('/gmail/v1/users/me/profile')).rejects.toMatchObject({
      kind: 'rate-limit',
    });
  });

  // ── e. Successful read() returns QuarantinedContent ─────────────────────────

  it('returns quarantined content on successful proxy response', async () => {
    const conn = makeConnection({ status: 'active', provider: 'gmail' });
    const mock = makeMockNango({ proxyStatus: 200, proxyData: { emailAddress: 'user@example.com' } });
    const client = new NangoConnectorClient(conn, mock, 'google-mail', 'nango-conn-id-1');
    const result = await client.read('/gmail/v1/users/me/profile');
    expect(isQuarantined(result.wrapped)).toBe(true);
    expect(result.source).toContain('gmail:');
    expect(result.wrapped).toContain('emailAddress');
  });

  it('read() sets source with provider:connectionId:path pattern', async () => {
    const conn = makeConnection({ status: 'active', provider: 'gmail', id: 'conn-xyz' });
    const mock = makeMockNango({ proxyStatus: 200, proxyData: { historyId: '9999' } });
    const client = new NangoConnectorClient(conn, mock, 'google-mail', 'nango-conn-id-1');
    const result = await client.read('/gmail/v1/users/me/profile');
    expect(result.source).toContain('gmail:conn-xyz');
  });

  // ── f. readJson() returns parsed data AND QuarantinedContent ────────────────

  it('readJson returns parsed data and quarantine wrapper', async () => {
    const conn = makeConnection({ status: 'active', provider: 'gmail' });
    const mock = makeMockNango({ proxyStatus: 200, proxyData: { historyId: '12345' } });
    const client = new NangoConnectorClient(conn, mock, 'google-mail', 'nango-conn-id-1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, quarantined } = await (client as any)['readJson']('/gmail/v1/users/me/profile');
    expect((data as { historyId: string }).historyId).toBe('12345');
    expect(isQuarantined(quarantined.wrapped)).toBe(true);
    expect(quarantined.source).toContain('gmail:');
  });

  // ── g. Provider errors (non-auth/rate-limit 4xx) → 'provider' error ─────────

  it('throws provider error on 500', async () => {
    const conn = makeConnection({ status: 'active', provider: 'gmail' });
    const mock = makeMockNango({ proxyStatus: 500, proxyData: { error: 'Internal Server Error' } });
    const client = new NangoConnectorClient(conn, mock, 'google-mail', 'nango-conn-id-1');
    await expect(client.read('/gmail/v1/users/me/profile')).rejects.toMatchObject({
      kind: 'provider',
      status: 500,
    });
  });

  it('throws provider error on 404', async () => {
    const conn = makeConnection({ status: 'active', provider: 'gmail' });
    const mock = makeMockNango({ proxyStatus: 404 });
    const client = new NangoConnectorClient(conn, mock, 'google-mail', 'nango-conn-id-1');
    await expect(client.read('/gmail/v1/users/me/profile')).rejects.toMatchObject({
      kind: 'provider',
      status: 404,
    });
  });

  // ── h. google-calendar descriptor works too ──────────────────────────────────

  it('works with google-calendar connector descriptor', async () => {
    const conn = makeConnection({ status: 'active', provider: 'google-calendar' });
    const mock = makeMockNango({ proxyStatus: 200, proxyData: { items: [] } });
    const client = new NangoConnectorClient(conn, mock, 'google-calendar', 'nango-conn-id-2');
    const result = await client.read('/calendar/v3/calendars/primary/events');
    expect(isQuarantined(result.wrapped)).toBe(true);
    expect(result.source).toContain('google-calendar:');
  });
});
