/**
 * Refresh-on-401: the connector base layer refreshes an expired access token
 * from the stored refresh token and replays the request once. Only
 * refreshAccessToken (the network token-exchange) is mocked; the real retry
 * loop, vault re-seal, and typed-error fallthrough are exercised over the http
 * egress seam.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

vi.mock('../src/oauth/flow', async (orig) => ({
  ...(await orig() as object),
  refreshAccessToken: vi.fn(),
}));

import { HttpConnectorClient } from '../src/connectors/base';
import { refreshAccessToken } from '../src/oauth/flow';
import { oauthClientCredentials } from '../src/oauth/client-credentials';
import { MemoryTokenVault, type StoredToken } from '../src/vault';
import type { Connection } from '../src/types';
import type { UnsafeTestOverrides } from '../src/egress/safe-fetch';

const overrides: UnsafeTestOverrides = {
  lookup: async () => [{ address: '127.0.0.1', family: 4 }],
  isPublicIp: () => true,
  allowHttp: true,
  allowAnyPort: true,
};

const CONN_ID = 'c0a80001-0000-4000-8000-000000000002';
function gmailConn(): Connection {
  return {
    id: CONN_ID, accountId: 'a', provider: 'gmail', method: 'H',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'], status: 'active',
    tokenRef: 'r', webhookState: {}, createdBy: null,
    createdAt: new Date(0).toISOString(), revokedAt: null,
  };
}

async function vaultWith(token: Partial<StoredToken>): Promise<MemoryTokenVault> {
  const v = new MemoryTokenVault();
  await v.store(CONN_ID, { accessToken: 'expired', scopes: ['x'], tokenType: 'Bearer', ...token });
  return v;
}

describe('connector refresh-on-401', () => {
  let server: http.Server;
  let port = 0;
  const auths: (string | undefined)[] = [];
  let calls = 0;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      auths.push(req.headers.authorization);
      calls += 1;
      if (calls === 1) { res.statusCode = 401; res.end('{}'); return; } // first call: expired
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => { await new Promise((r) => server.close(r)); });

  beforeEach(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'secret';
    auths.length = 0; calls = 0; vi.clearAllMocks();
  });

  const base = () => `http://gmail.googleapis.com:${port}`;

  it('refreshes + retries once on 401, re-seals the vault, succeeds with the new token', async () => {
    (refreshAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      accessToken: 'refreshed', refreshToken: 'rt', scopes: ['x'], tokenType: 'Bearer',
    });
    const vault = await vaultWith({ refreshToken: 'rt' });
    const client = new HttpConnectorClient(gmailConn(), base(), vault, overrides);
    await client.read('/v1/x');
    expect(refreshAccessToken).toHaveBeenCalledOnce();
    // first request used the expired token, the retry used the refreshed one
    expect(auths).toEqual(['Bearer expired', 'Bearer refreshed']);
    expect((await vault.read(CONN_ID)).accessToken).toBe('refreshed');
  });

  it('throws a typed auth error (no retry) when there is no refresh token', async () => {
    const vault = await vaultWith({}); // no refreshToken
    const client = new HttpConnectorClient(gmailConn(), base(), vault, overrides);
    await expect(client.read('/v1/x')).rejects.toMatchObject({ kind: 'auth' });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('throws a typed auth error when refresh itself fails (revoked refresh token)', async () => {
    (refreshAccessToken as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('invalid_grant'));
    const vault = await vaultWith({ refreshToken: 'rt' });
    const client = new HttpConnectorClient(gmailConn(), base(), vault, overrides);
    await expect(client.read('/v1/x')).rejects.toMatchObject({ kind: 'auth' });
    expect(refreshAccessToken).toHaveBeenCalledOnce();
  });
});

describe('oauthClientCredentials', () => {
  it('resolves Google-family providers from GOOGLE_OAUTH_* env', () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'sec';
    expect(oauthClientCredentials('gmail')).toEqual({ clientId: 'cid', clientSecret: 'sec' });
    expect(oauthClientCredentials('google-calendar')).toEqual({ clientId: 'cid', clientSecret: 'sec' });
  });

  it('returns null for unconfigured / unknown providers', () => {
    expect(oauthClientCredentials('stripe')).toBeNull();
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    expect(oauthClientCredentials('gmail')).toBeNull();
  });
});
