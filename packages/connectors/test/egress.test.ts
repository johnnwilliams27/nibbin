/**
 * SSRF suite (M3 DoD): the deny-by-default egress proxy. Attack vectors
 * first — every internal address family, rebinding, credential exfil via
 * redirect — then positive-path behavior against in-process servers.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { isPublicIp, isPublicIpv4, isPublicIpv6, parseIpv4 } from '../src/egress/ip';
import { safeFetch, hostMatchesPattern, EgressDeniedError, type UnsafeTestOverrides } from '../src/egress/safe-fetch';

describe('public-IP classification', () => {
  const blocked = [
    '127.0.0.1', '127.8.8.8', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', '0.0.0.0', '0.1.2.3', '192.0.0.1', '192.0.2.5', '198.18.0.1',
    '198.51.100.7', '203.0.113.9', '224.0.0.1', '240.0.0.1', '255.255.255.255', '192.88.99.1',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '100::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', // v4-mapped
    '64:ff9b::7f00:1', '64:ff9b::a00:1', // NAT64-embedded loopback/private
    '2001:db8::1', '2001:0:abcd::1', // documentation, teredo
    '2002:7f00:0001::1', // 6to4 embedding 127.0.0.1
    'fe80::1%eth0',
  ];
  const allowed = ['8.8.8.8', '1.1.1.1', '142.250.80.46', '2607:f8b0:4004:c07::6a', '2600::1', '64:ff9b::808:808'];

  it.each(blocked)('blocks %s', (addr) => {
    expect(isPublicIp(addr)).toBe(false);
  });

  it.each(allowed)('allows %s', (addr) => {
    expect(isPublicIp(addr)).toBe(true);
  });

  it('rejects parser-disagreement v4 forms (octal, short, overflow)', () => {
    expect(parseIpv4('010.0.0.1')).toBeNull();
    expect(parseIpv4('127.1')).toBeNull();
    expect(parseIpv4('256.1.1.1')).toBeNull();
    expect(parseIpv4('1.2.3.4.5')).toBeNull();
    expect(isPublicIpv4('0x7f.0.0.1')).toBe(false);
  });

  it('rejects malformed v6', () => {
    expect(isPublicIpv6('1:::2')).toBe(false);
    expect(isPublicIpv6('1:2:3:4:5:6:7:8:9')).toBe(false);
    expect(isPublicIpv6('gggg::1')).toBe(false);
  });
});

describe('host allowlist patterns', () => {
  it('exact and wildcard-suffix matching, case-insensitive, no substring tricks', () => {
    expect(hostMatchesPattern('api.stripe.com', 'api.stripe.com')).toBe(true);
    expect(hostMatchesPattern('API.STRIPE.COM', 'api.stripe.com')).toBe(true);
    expect(hostMatchesPattern('evil-api.stripe.com.attacker.net', 'api.stripe.com')).toBe(false);
    expect(hostMatchesPattern('a.b.example.com', '*.example.com')).toBe(true);
    expect(hostMatchesPattern('example.com', '*.example.com')).toBe(true);
    expect(hostMatchesPattern('notexample.com', '*.example.com')).toBe(false);
  });
});

describe('safeFetch denials (no network touched)', () => {
  it('https only', async () => {
    await expect(safeFetch('http://example.com/')).rejects.toThrowError(/protocol/);
    await expect(safeFetch('ftp://example.com/')).rejects.toThrowError(/protocol/);
    await expect(safeFetch('file:///etc/passwd')).rejects.toThrowError(/protocol/);
  });

  it('no userinfo, no exotic ports', async () => {
    await expect(safeFetch('https://user:pass@example.com/')).rejects.toThrowError(/userinfo/);
    await expect(safeFetch('https://example.com:8443/')).rejects.toThrowError(/port/);
  });

  it('private/literal targets are refused outright', async () => {
    for (const target of [
      'https://127.0.0.1/', 'https://10.0.0.1/', 'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/', 'https://[fd00::1]/', 'https://[::ffff:127.0.0.1]/',
    ]) {
      await expect(safeFetch(target), target).rejects.toThrowError(/private-ip/);
    }
  });

  it('enforces the connector allowlist', async () => {
    await expect(
      safeFetch('https://attacker.example/', {}, { allowedHosts: ['api.stripe.com'] }),
    ).rejects.toThrowError(/allowlist/);
  });

  it('denies when DNS resolves to anything non-public (rebinding/split-horizon)', async () => {
    const overrides: UnsafeTestOverrides = {
      lookup: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.5', family: 4 }, // one private answer poisons the set
      ],
    };
    await expect(safeFetch('https://rebind.example/', {}, {}, overrides)).rejects.toThrowError(/private-ip/);
  });

  it('credential headers without an entitlement are refused (generic rails)', async () => {
    await expect(
      safeFetch('https://mcp.example/', { headers: { Authorization: 'Bearer user-token' } }),
    ).rejects.toThrowError(/credentials/);
  });

  it('credential headers to a non-entitled host are refused', async () => {
    await expect(
      safeFetch(
        'https://other.example/',
        { headers: { authorization: 'Bearer t' } },
        { credentialHosts: ['mcp.example'] },
      ),
    ).rejects.toThrowError(/credentials/);
  });
});

describe('safeFetch against in-process servers (test overrides only)', () => {
  let server: http.Server;
  let port = 0;

  // overrides: fake hosts resolve to loopback and loopback is "public" — this
  // weakening exists ONLY here; production callers cannot reach these seams.
  const overrides: UnsafeTestOverrides = {
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    isPublicIp: () => true,
    allowHttp: true,
    allowAnyPort: true,
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const host = req.headers.host?.split(':')[0];
      if (req.url === '/echo') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ host, method: req.method, auth: req.headers.authorization ?? null }));
      } else if (req.url === '/redirect-cross-host') {
        res.statusCode = 302;
        res.setHeader('location', `http://host-b.test:${port}/echo`);
        res.end();
      } else if (req.url === '/redirect-loop') {
        res.statusCode = 302;
        res.setHeader('location', `http://host-a.test:${port}/redirect-loop`);
        res.end();
      } else if (req.url === '/see-other') {
        res.statusCode = 303;
        res.setHeader('location', `http://host-a.test:${port}/echo`);
        res.end();
      } else if (req.url === '/big') {
        res.end('x'.repeat(64 * 1024));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('round-trips and pins the connection while preserving the Host header', async () => {
    const res = await safeFetch(`http://host-a.test:${port}/echo`, {}, {}, overrides);
    expect(res.status).toBe(200);
    expect((res.json() as { host: string }).host).toBe('host-a.test');
  });

  it('strips credential headers on cross-host redirects', async () => {
    const res = await safeFetch(
      `http://host-a.test:${port}/redirect-cross-host`,
      { headers: { authorization: 'Bearer secret-token' } },
      { credentialHosts: ['host-a.test'] },
      overrides,
    );
    expect(res.status).toBe(200);
    expect((res.json() as { auth: string | null; host: string }).auth).toBeNull();
    expect((res.json() as { host: string }).host).toBe('host-b.test');
  });

  it('redirect hops re-run the allowlist', async () => {
    await expect(
      safeFetch(`http://host-a.test:${port}/redirect-cross-host`, {}, { allowedHosts: ['host-a.test'] }, overrides),
    ).rejects.toThrowError(/allowlist/);
  });

  it('caps redirect chains', async () => {
    await expect(
      safeFetch(`http://host-a.test:${port}/redirect-loop`, {}, {}, overrides),
    ).rejects.toThrowError(/redirect/);
  });

  it('303 converts POST to GET and drops the body', async () => {
    const res = await safeFetch(
      `http://host-a.test:${port}/see-other`,
      { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } },
      {},
      overrides,
    );
    expect((res.json() as { method: string }).method).toBe('GET');
  });

  it('enforces the response size cap', async () => {
    await expect(
      safeFetch(`http://host-a.test:${port}/big`, {}, { maxResponseBytes: 1024 }, overrides),
    ).rejects.toThrowError(/size/);
  });

  it('denial errors are EgressDeniedError with a stable reason', async () => {
    const err = await safeFetch('https://127.0.0.1/', {}, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EgressDeniedError);
    expect((err as EgressDeniedError).reason).toBe('private-ip');
  });
});
