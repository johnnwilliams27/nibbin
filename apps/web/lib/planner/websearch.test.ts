/**
 * Open-web utility (Slice 3a, design §4) — the privacy-load-bearing part. The
 * query is redacted BEFORE egress; only an allowlisted provider host is
 * contacted; results come back quarantined + length-capped; web.fetch rejects
 * private IPs / non-http(s) / credentials-in-URL; no provider key → not offered
 * and a direct call returns a clean error.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isQuarantined } from '@nibbin/connectors';
import { webSearch, webFetch, webSearchEnabled } from './websearch';

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
  it('rejects a non-http(s) scheme', async () => {
    const out = await webFetch('file:///etc/passwd');
    expect(isQuarantined(out)).toBe(true);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await webFetch('ftp://x.com/y');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects credentials in the URL', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const out = await webFetch('https://user:pass@example.com/');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isQuarantined(out)).toBe(true);
  });

  it('rejects a private / loopback host', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const url of ['http://127.0.0.1/', 'http://localhost/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/', 'http://192.168.1.1/']) {
      const out = await webFetch(url);
      expect(isQuarantined(out)).toBe(true);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches a public https URL and quarantines + caps the result', async () => {
    const big = 'A'.repeat(50_000);
    const fetchMock = vi.fn(async () => new Response(big, { status: 200, headers: { 'content-type': 'text/plain' } }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await webFetch('https://example.com/article');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isQuarantined(out)).toBe(true);
    // length-capped (well under the raw 50k)
    expect(out.length).toBeLessThan(20_000);
  });
});
