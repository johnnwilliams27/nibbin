/**
 * Hand-built client plumbing (C8/C9 at the client layer), the Supabase vault
 * client over a fake PostgREST, and the aggregator adapter. Fake servers are
 * routed via Host headers; egress test seams only.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpConnectorClient, ConnectorRequestError } from '../src/connectors/base';
import { GmailClient } from '../src/connectors/gmail';
import { GoogleCalendarClient } from '../src/connectors/google-calendar';
import { InstagramDmClient, IG_REPLY_GRANT } from '../src/connectors/instagram';
import { MemoryTokenVault, SupabaseTokenVault, redactToken, type StoredToken } from '../src/vault';
import { AggregatorGateway, AggregatorConnectorClient } from '../src/aggregator';
import { SendVelocityLimiter, MemorySendRecordStore } from '../src/send-velocity';
import { isQuarantined } from '../src/quarantine';
import type { Connection } from '../src/types';
import type { UnsafeTestOverrides } from '../src/egress/safe-fetch';

const overrides: UnsafeTestOverrides = {
  lookup: async () => [{ address: '127.0.0.1', family: 4 }],
  isPublicIp: () => true,
  allowHttp: true,
  allowAnyPort: true,
};

function connection(partial: Partial<Connection> = {}): Connection {
  return {
    id: 'c0a80001-0000-4000-8000-000000000001',
    accountId: 'acct-1',
    provider: 'stripe',
    method: 'H',
    scopes: ['read_only'],
    status: 'active',
    tokenRef: 'ref-1',
    webhookState: {},
    createdBy: null,
    createdAt: new Date(0).toISOString(),
    revokedAt: null,
    ...partial,
  };
}

async function vaultWith(token: Partial<StoredToken> = {}, connectionId = connection().id): Promise<MemoryTokenVault> {
  const vault = new MemoryTokenVault();
  await vault.store(connectionId, {
    accessToken: 'sk_live_secret',
    scopes: ['read_only'],
    tokenType: 'Bearer',
    ...token,
  });
  return vault;
}

describe('HttpConnectorClient (base plumbing)', () => {
  let server: http.Server;
  let port = 0;
  let lastAuth: string | undefined;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      lastAuth = req.headers.authorization;
      if (req.url?.startsWith('/v1/teapot')) {
        res.statusCode = 418;
        res.end('{}');
      } else if (req.url?.startsWith('/v1/limited')) {
        res.statusCode = 429;
        res.end('{}');
      } else if (req.url?.startsWith('/v1/expired')) {
        res.statusCode = 401;
        res.end('{}');
      } else {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ data: [{ id: 'in_1' }], has_more: false }));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const base = () => `http://api.stripe.com:${port}`;

  it('vault token rides as Authorization; responses come back quarantined', async () => {
    const vault = await vaultWith();
    const client = new HttpConnectorClient(connection(), base(), vault, overrides);
    const q = await client.read('/v1/invoices');
    expect(isQuarantined(q.wrapped)).toBe(true);
    expect(q.source).toContain('stripe:');
    expect(lastAuth).toBe('Bearer sk_live_secret');
  });

  it('refuses base URLs outside the connector egress allowlist', async () => {
    const vault = await vaultWith();
    expect(() => new HttpConnectorClient(connection(), `http://evil.test:${port}`, vault, overrides)).toThrow(
      /egress allowlist/,
    );
  });

  it('non-active connections are unusable (revocation cascades, C9)', async () => {
    const vault = await vaultWith();
    for (const status of ['revoked', 'paused', 'pending', 'error'] as const) {
      const client = new HttpConnectorClient(connection({ status }), base(), vault, overrides);
      await expect(client.read('/v1/invoices')).rejects.toThrowError(/connection-state/);
    }
  });

  it('maps auth/rate-limit/provider failures to typed errors', async () => {
    const vault = await vaultWith();
    const client = new HttpConnectorClient(connection(), base(), vault, overrides);
    await expect(client.read('/v1/expired')).rejects.toMatchObject({ kind: 'auth' });
    await expect(client.read('/v1/limited')).rejects.toMatchObject({ kind: 'rate-limit' });
    const err = await client.read('/v1/teapot').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectorRequestError);
    expect((err as ConnectorRequestError).kind).toBe('provider');
  });
});

describe('write paths are adoption-gated (C8) and velocity-capped (RISKS §2)', () => {
  const limiter = () => new SendVelocityLimiter(new MemorySendRecordStore());
  const matureAccount = Date.now() - 90 * 86_400_000;

  it('gmail drafts demand the compose grant', async () => {
    const conn = connection({ provider: 'gmail', scopes: ['https://www.googleapis.com/auth/gmail.metadata'] });
    const client = new GmailClient(conn, await vaultWith({}, conn.id), overrides);
    await expect(client.createDraft('cmF3')).rejects.toThrowError(/granted per-Nibbin at adoption/);
  });

  it('gmail sends demand the send grant', async () => {
    const conn = connection({ provider: 'gmail', scopes: ['https://www.googleapis.com/auth/gmail.metadata'] });
    const client = new GmailClient(conn, await vaultWith({}, conn.id), overrides);
    await expect(client.sendMessage('cmF3', limiter(), matureAccount)).rejects.toThrowError(
      /granted per-Nibbin at adoption/,
    );
  });

  it('gmail sends stop at the velocity cap even with the grant', async () => {
    const conn = connection({
      provider: 'gmail',
      scopes: ['https://www.googleapis.com/auth/gmail.metadata', 'https://www.googleapis.com/auth/gmail.send'],
    });
    const client = new GmailClient(conn, await vaultWith({}, conn.id), overrides);
    const l = limiter();
    // exhaust the hourly budget out-of-band
    const gmailDescriptor = client.descriptor;
    for (let i = 0; i < gmailDescriptor.send!.velocity.perAccountPerHour; i++) {
      await l.checkAndConsume(conn.accountId, gmailDescriptor, matureAccount);
    }
    await expect(client.sendMessage('cmF3', l, matureAccount)).rejects.toThrowError(/velocity cap/);
  });

  it('instagram replies demand the adoption grant marker', async () => {
    const conn = connection({
      provider: 'instagram-dm',
      scopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
    });
    const client = new InstagramDmClient(conn, await vaultWith({}, conn.id), overrides);
    await expect(client.sendReply('user-1', 'hi', limiter(), matureAccount)).rejects.toThrowError(
      /adoption grant/,
    );
    expect(IG_REPLY_GRANT).toMatch(/^nibbin:grant:/);
  });
});

describe('SupabaseTokenVault over PostgREST (C9 client)', () => {
  let server: http.Server;
  let port = 0;
  const calls: Array<{ path: string; body: unknown; auth?: string }> = [];
  const secrets = new Map<string, string>();

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        calls.push({ path: req.url!, body: JSON.parse(body) as unknown, auth: req.headers.authorization });
        const args = JSON.parse(body) as { p_connection: string; p_token?: string };
        res.setHeader('content-type', 'application/json');
        if (req.url === '/rest/v1/rpc/connection_token_store') {
          secrets.set(args.p_connection, args.p_token!);
          res.end('"11111111-2222-4333-8444-555555555555"');
        } else if (req.url === '/rest/v1/rpc/connection_token_read') {
          const payload = secrets.get(args.p_connection);
          if (!payload) {
            res.statusCode = 400;
            res.end('{}');
          } else {
            res.end(JSON.stringify(payload));
          }
        } else if (req.url === '/rest/v1/rpc/connection_revoke') {
          secrets.delete(args.p_connection);
          res.end('');
        } else {
          res.statusCode = 404;
          res.end('{}');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('round-trips a token through the RPC surface and revokes', async () => {
    const vault = new SupabaseTokenVault(
      { supabaseUrl: `http://db.supabase.test:${port}`, serviceKey: 'sb_secret_test' },
      overrides,
    );
    const token: StoredToken = { accessToken: 'ya29.secret', refreshToken: '1//rt', scopes: ['s'], tokenType: 'Bearer' };
    const ref = await vault.store('conn-9', token);
    expect(ref).toBe('11111111-2222-4333-8444-555555555555');
    expect(await vault.read('conn-9')).toEqual(token);
    await vault.revoke('conn-9', 'user-1');
    await expect(vault.read('conn-9')).rejects.toThrow();
    expect(calls.every((c) => c.auth === 'Bearer sb_secret_test')).toBe(true);
  });

  it('refuses plaintext Supabase URLs outside tests', () => {
    expect(() => new SupabaseTokenVault({ supabaseUrl: 'http://x.test', serviceKey: 'k' })).toThrow(/https/);
  });

  it('redactToken never exposes token material', () => {
    const red = redactToken({ accessToken: 'sek-access-12345', refreshToken: 'rtok-refresh-9876', scopes: ['a'] });
    expect(JSON.stringify(red)).not.toContain('sek-access-12345');
    expect(JSON.stringify(red)).not.toContain('rtok-refresh-9876');
  });
});

describe('aggregator adapter (method A)', () => {
  let server: http.Server;
  let port = 0;
  const sessions: Array<{ scopes: string[] }> = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/connect/sessions') {
          const parsed = JSON.parse(body) as { scopes: string[] };
          sessions.push({ scopes: parsed.scopes });
          res.end(JSON.stringify({ data: { token: 'sess-token' } }));
        } else if (req.url?.startsWith('/proxy/')) {
          res.end(JSON.stringify({ data: [{ id: 'evt' }] }));
        } else {
          res.statusCode = 404;
          res.end('{}');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const gateway = () =>
    new AggregatorGateway({ baseUrl: `http://api.nango.test:${port}`, secretKey: 'nango-secret' }, overrides);

  it('first connect sessions ask for READ scopes only (C8)', async () => {
    await gateway().createConnectSession('slack', 'acct-1');
    const last = sessions.at(-1)!;
    expect(last.scopes).toContain('channels:read');
    expect(last.scopes).not.toContain('chat:write');
  });

  it('write upgrades are per-Nibbin, reasoned, and subset-checked', async () => {
    const g = gateway();
    await expect(g.createWriteUpgradeSession('slack', 'acct-1', ['chat:write'], '', 'long enough reason here')).rejects.toThrow(/per-Nibbin/);
    await expect(g.createWriteUpgradeSession('slack', 'acct-1', ['chat:write'], 'nib-1', 'short')).rejects.toThrow(/per-Nibbin|reason/);
    await expect(g.createWriteUpgradeSession('slack', 'acct-1', ['admin'], 'nib-1', 'long enough reason here')).rejects.toThrow(/declared write scope/);
    await g.createWriteUpgradeSession('slack', 'acct-1', ['chat:write'], 'nib-1', 'Scout posts your approved replies.');
    expect(sessions.at(-1)!.scopes).toContain('chat:write');
  });

  it('rejects hand-built/generic providers', async () => {
    await expect(gateway().createConnectSession('gmail', 'acct-1')).rejects.toThrow(/not an aggregator/);
  });

  it('proxy reads come back quarantined with the vaulted handle', async () => {
    const conn = connection({ provider: 'slack', method: 'A' });
    const vault = new MemoryTokenVault();
    const g = gateway();
    await g.storeConnectionHandle(vault, conn.id, 'nango-conn-42');
    const client = new AggregatorConnectorClient(conn, g, vault);
    const q = await client.read('/conversations.history');
    expect(isQuarantined(q.wrapped)).toBe(true);
    expect((await vault.read(conn.id)).accessToken).toBe('nango-conn-42');
  });
});

// FIX 2: GoogleCalendarClient must request fields= on every API call to exclude
// raw PII (event titles / attendee emails) — derived-not-raw hardening.
describe('GoogleCalendarClient — derived-not-raw fields restriction (Fix 2)', () => {
  function makeCalConn() {
    return connection({ provider: 'google-calendar', scopes: ['https://www.googleapis.com/auth/calendar.readonly'] });
  }

  it('listEvents includes fields= that excludes summary and attendee email', async () => {
    const conn = makeCalConn();
    const vault = await vaultWith({}, conn.id);
    const client = new GoogleCalendarClient(conn, vault, overrides);

    let capturedPath = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(client as any, 'readJson').mockImplementation(async (...args: unknown[]) => {
      capturedPath = args[0] as string;
      return { data: { items: [], nextPageToken: undefined }, quarantined: {} };
    });

    await client.listEvents('primary', new Date(0).toISOString(), new Date().toISOString());

    const url = new URL(capturedPath, 'https://fixture.invalid');
    const fields = url.searchParams.get('fields') ?? '';
    // Must restrict to known-safe fields only — no summary, no attendee email
    expect(fields).toBeTruthy();
    expect(fields).not.toContain('summary');
    expect(fields).not.toContain('email');
    // Must include fields needed by scan modules
    expect(fields).toContain('status');
    expect(fields).toContain('responseStatus');
  });

  it('listEventsSync (delta path) includes fields= that excludes summary and attendee email', async () => {
    const conn = makeCalConn();
    const vault = await vaultWith({}, conn.id);
    const client = new GoogleCalendarClient(conn, vault, overrides);

    let capturedPath = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(client as any, 'readJson').mockImplementation(async (...args: unknown[]) => {
      capturedPath = args[0] as string;
      return { data: { items: [], nextSyncToken: 'tok1' }, quarantined: {} };
    });

    await client.listEventsSync('primary', 'sync-token-abc');

    const url = new URL(capturedPath, 'https://fixture.invalid');
    const fields = url.searchParams.get('fields') ?? '';
    // Delta path only needs id + status for dispatch
    expect(fields).toBeTruthy();
    expect(fields).not.toContain('summary');
    expect(fields).not.toContain('email');
    expect(fields).toContain('status');
    // Must include nextSyncToken in fields so pagination advance token is returned
    expect(fields).toContain('nextSyncToken');
  });
});

describe('GmailClient.historyList + getProfile', () => {
  function makeGmailConn() {
    return connection({ provider: 'gmail', scopes: ['https://www.googleapis.com/auth/gmail.metadata'] });
  }

  it('historyList builds the correct query params', async () => {
    const conn = makeGmailConn();
    const vault = await vaultWith({}, conn.id);
    const client = new GmailClient(conn, vault, overrides);

    let capturedPath = '';
    // readJson is protected but accessible at runtime; use unknown[] to satisfy
    // vi.spyOn's mockImplementation constraint while still reading the first arg.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(client as any, 'readJson').mockImplementation(async (...args: unknown[]) => {
      capturedPath = args[0] as string;
      return { data: { history: [], historyId: '9999' }, quarantined: {} };
    });

    await client.historyList({ startHistoryId: '1234' });
    expect(capturedPath).toContain('startHistoryId=1234');
    expect(capturedPath).toContain('historyTypes=messageAdded');
  });

  it('historyList defaults maxResults to 100', async () => {
    const conn = makeGmailConn();
    const vault = await vaultWith({}, conn.id);
    const client = new GmailClient(conn, vault, overrides);

    let capturedPath = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(client as any, 'readJson').mockImplementation(async (...args: unknown[]) => {
      capturedPath = args[0] as string;
      return { data: { history: [], historyId: '1' }, quarantined: {} };
    });

    await client.historyList({ startHistoryId: '0' });
    expect(capturedPath).toContain('maxResults=100');
  });

  it('getProfile returns emailAddress and historyId', async () => {
    const conn = makeGmailConn();
    const vault = await vaultWith({}, conn.id);
    const client = new GmailClient(conn, vault, overrides);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(client as any, 'readJson').mockResolvedValue({
      data: { emailAddress: 'user@gmail.com', historyId: '5555' },
      quarantined: {},
    });

    const profile = await client.getProfile();
    expect(profile.emailAddress).toBe('user@gmail.com');
    expect(profile.historyId).toBe('5555');
  });
});
