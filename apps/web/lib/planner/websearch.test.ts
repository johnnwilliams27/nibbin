/**
 * Open-web utility (Slice 3a, design §4) — the privacy-load-bearing part. The
 * query is redacted BEFORE egress; only an allowlisted provider host is
 * contacted; results come back quarantined + length-capped; web.fetch rejects
 * private IPs / non-http(s) / credentials-in-URL; no provider key → not offered
 * and a direct call returns a clean error.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { isQuarantined } from '@nibbin/connectors';
import { webSearch, webFetch, webSearchEnabled, type WebFetchTestSeams } from './websearch';

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('webSearchEnabled', () => {
  it('false with no key', () => {
    delete process.env.WEB_SEARCH_API_KEY;
    expect(webSearchEnabled()).toBe(false);
  });
  it('true with a key', () => {
    process.env.WEB_SEARCH_API_KEY = 'k';
    expect(webSearchEnabled()).toBe(true);
  });
});

describe('webSearch — redact before egress', () => {
  it('(a) runs the query through the redaction battery BEFORE the outbound call', async () => {
    process.env.WEB_SEARCH_API_KEY = 'k';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ results: [{ title: 'r', snippet: 's' }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await webSearch('email me at jane.doe@example.com about it');
    // the egressed string must carry the redaction placeholder, NOT the raw PII
    const egressed = JSON.stringify(fetchMock.mock.calls);
    expect(egressed).not.toContain('jane.doe@example.com');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // (c) result is quarantined
    expect(isQuarantined(out)).toBe(true);
  });

  it('(b) only contacts the allowlisted provider host', async () => {
    process.env.WEB_SEARCH_API_KEY = 'k';
    const fetchMock = vi.fn(async (_url: string | URL) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await webSearch('hello world');
    const url = String(fetchMock.mock.calls[0]?.[0]);
    const host = new URL(url).host;
    expect(host).toMatch(/^(api\.)?(tavily|brave|search)/);
  });

  it('(d) with no provider key, a direct call returns a clean quarantined error and does NOT fetch', async () => {
    delete process.env.WEB_SEARCH_API_KEY;
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await webSearch('anything');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isQuarantined(out)).toBe(true);
    expect(out.toLowerCase()).toContain('unavailable');
  });
});

describe('webFetch — SSRF guard', () => {
  // A `lookup` seam that fails the test if it is ever called — proves a URL was
  // refused by a pre-DNS guard (scheme / credentials / literal private IP)
  // before any outbound resolution or connection happened.
  const noResolve: WebFetchTestSeams = {
    lookup: async () => {
      throw new Error('DNS lookup must not be reached for a pre-filtered URL');
    },
  };

  it('rejects a non-http(s) scheme without touching DNS', async () => {
    expect(isQuarantined(await webFetch('file:///etc/passwd', noResolve))).toBe(true);
    const out = await webFetch('ftp://x.com/y', noResolve);
    expect(isQuarantined(out)).toBe(true);
    expect(out.toLowerCase()).toContain('http');
  });

  it('rejects credentials in the URL without touching DNS', async () => {
    const out = await webFetch('https://user:pass@example.com/', noResolve);
    expect(isQuarantined(out)).toBe(true);
    expect(out.toLowerCase()).toContain('credentials');
  });

  it('rejects a literal private / loopback / link-local / metadata host without touching DNS', async () => {
    for (const url of [
      'http://127.0.0.1/',
      'http://localhost/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://[::1]/',
      'http://[fc00::1]/',
      // octal-form loopback — the old hand-rolled regex missed this; isPublicIp catches it
      'http://0177.0.0.1/',
    ]) {
      const out = await webFetch(url, noResolve);
      expect(isQuarantined(out), url).toBe(true);
      expect(out.toLowerCase(), url).toContain('not reachable');
    }
  });

  it('DNS-REBIND: a PUBLIC hostname that resolves to a private/loopback/link-local/metadata IP is rejected (no connect)', async () => {
    // The literal pre-filter passes (the host string is public-looking); the
    // defense is safeFetch resolving the name and refusing the non-public
    // answer, so the TCP connect to the private IP never happens.
    for (const privateAddr of ['127.0.0.1', '10.0.0.5', '169.254.169.254', '::1', 'fc00::1']) {
      const family = privateAddr.includes(':') ? 6 : 4;
      const rebind: WebFetchTestSeams = {
        // default isPublicIp (NOT overridden) → the private answer is rejected
        lookup: async () => [{ address: privateAddr, family }],
      };
      const out = await webFetch('https://totally-public-looking.example/', rebind);
      expect(isQuarantined(out), privateAddr).toBe(true);
      expect(out.toLowerCase(), privateAddr).toContain('not reachable');
    }
  });

  it('a hostname resolving to a PUBLIC IP is allowed (round-trips, quarantined + capped)', async () => {
    const server = http.createServer((_req, res) => {
      res.setHeader('content-type', 'text/plain');
      res.end('A'.repeat(50_000));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      // Treat loopback as public + allow the ephemeral port so the request can
      // reach the in-process server — exactly the connector egress suite's seam.
      const ok: WebFetchTestSeams = {
        lookup: async () => [{ address: '127.0.0.1', family: 4 }],
        isPublicIp: () => true,
        allowHttp: true,
        allowAnyPort: true,
      };
      const out = await webFetch(`http://public.example:${port}/article`, ok);
      expect(isQuarantined(out)).toBe(true);
      // length-capped (well under the raw 50k)
      expect(out.length).toBeLessThan(20_000);
      expect(out).toContain('AAAA');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
