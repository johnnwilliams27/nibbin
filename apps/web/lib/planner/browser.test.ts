/**
 * The computer_use (browser) Playwright adapter SSRF + lifecycle tests
 * (apps/web), at web.fetch parity (mirrors websearch.test.ts's SSRF battery).
 *
 * The load-bearing egress defense for the browser surface is NOT the throwaway
 * navigate probe (a separate, unpinned page.goto re-resolves DNS) — it is:
 *  1. `assertSafeNavigateUrl` (the runtime guard, fed the REAL connectors
 *     isPublicIp) rejecting the literal-private / metadata / credentials /
 *     non-http(s) battery; and
 *  2. the per-request Chromium interceptor (`isRequestEgressAllowed`) resolving
 *     EVERY request (main nav, redirects, subresources) and aborting any that
 *     resolves to a non-public IP — closing redirect / JS-redirect / DNS-rebind /
 *     subresource holes.
 *
 * The real Playwright `page.route` wiring stays unexercised (the dep is absent,
 * the flag is off) — these test the validation LOGIC it calls, plus the
 * launch↔close lifecycle against a FAKE Pw module.
 */
import { describe, expect, it, vi } from 'vitest';
import { EgressDeniedError, isPublicIp, isQuarantined, type SafeResponse } from '@nibbin/connectors';
import { assertSafeNavigateUrl, validateComputerUseArgs, validateTarget } from '@nibbin/runtime';
import { isRequestEgressAllowed, PlaywrightBrowserDriver, type SafeFetchFn } from './browser';

/* ── assertSafeNavigateUrl at web.fetch parity (the runtime guard, REAL isPublicIp) ── */

describe('assertSafeNavigateUrl — SSRF battery (real connectors isPublicIp)', () => {
  it('rejects literal private / loopback / link-local / metadata / octal-loopback hosts', () => {
    for (const url of [
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://[::1]/',
      'http://[fc00::1]/',
      // octal-form loopback — a hand-rolled regex would miss this; isPublicIp catches it
      'http://0177.0.0.1/',
    ]) {
      expect(() => assertSafeNavigateUrl(url, isPublicIp), url).toThrow();
    }
  });

  it('rejects localhost (internal suffix) without an isPublicIp consult', () => {
    expect(() => assertSafeNavigateUrl('http://localhost/', isPublicIp)).toThrow(/internal/);
    expect(() => assertSafeNavigateUrl('http://foo.internal/', isPublicIp)).toThrow(/internal/);
  });

  it('rejects credentials-in-URL', () => {
    expect(() => assertSafeNavigateUrl('https://user:pass@example.com/', isPublicIp)).toThrow(/credentials/);
  });

  it('rejects a non-http(s) scheme', () => {
    expect(() => assertSafeNavigateUrl('file:///etc/passwd', isPublicIp)).toThrow(/http/);
    expect(() => assertSafeNavigateUrl('ftp://example.com/', isPublicIp)).toThrow(/http/);
  });

  it('allows a public hostname literal-prefilter (DNS rebind is caught downstream)', () => {
    expect(() => assertSafeNavigateUrl('https://example.com/path', isPublicIp)).not.toThrow();
  });
});

/* ── isRequestEgressAllowed — the per-request interception decision ──────────── */

describe('isRequestEgressAllowed — per-request egress validation (the interceptor)', () => {
  it('ALLOWS a public hostname (resolves to a public IP)', async () => {
    const lookup = async () => [{ address: '93.184.216.34' }]; // example.com
    expect(await isRequestEgressAllowed('https://example.com/', isPublicIp, lookup)).toBe(true);
  });

  it('ABORTS a literal private / metadata IP without a lookup', async () => {
    const lookup = async () => {
      throw new Error('lookup must not be reached for a literal IP');
    };
    expect(await isRequestEgressAllowed('http://169.254.169.254/latest/meta-data/', isPublicIp, lookup)).toBe(false);
    expect(await isRequestEgressAllowed('http://127.0.0.1/', isPublicIp, lookup)).toBe(false);
    expect(await isRequestEgressAllowed('http://10.0.0.5/', isPublicIp, lookup)).toBe(false);
  });

  it('ABORTS a DNS-REBIND: a public hostname resolving to a private IP', async () => {
    // One private answer poisons the whole set (mirrors safeFetch).
    const rebind = async () => [{ address: '169.254.169.254' }];
    expect(await isRequestEgressAllowed('https://totally-public-looking.example/', isPublicIp, rebind)).toBe(false);
    const mixed = async () => [{ address: '93.184.216.34' }, { address: '127.0.0.1' }];
    expect(await isRequestEgressAllowed('https://split-horizon.example/', isPublicIp, mixed)).toBe(false);
  });

  it('ABORTS non-http(s), credentials-in-URL, localhost, and DNS failure', async () => {
    const ok = async () => [{ address: '93.184.216.34' }];
    expect(await isRequestEgressAllowed('file:///etc/passwd', isPublicIp, ok)).toBe(false);
    expect(await isRequestEgressAllowed('https://user:pass@example.com/', isPublicIp, ok)).toBe(false);
    expect(await isRequestEgressAllowed('http://localhost/', isPublicIp, ok)).toBe(false);
    const fail = async () => {
      throw new Error('NXDOMAIN');
    };
    expect(await isRequestEgressAllowed('https://nope.example/', isPublicIp, fail)).toBe(false);
    const empty = async () => [];
    expect(await isRequestEgressAllowed('https://noaddr.example/', isPublicIp, empty)).toBe(false);
  });
});

/* ── lifecycle: launch ↔ close pairing against a FAKE Pw module ──────────────── */

interface FakeCounters {
  launches: number;
  closes: number;
  routePatterns: string[];
  /** the handler registered via context.route('**', …) — captured so a test
   *  can drive the interceptor with a fake route without a real Chromium. */
  routeHandler?: (route: unknown) => void | Promise<void>;
}

function fakePwModule(
  counters: FakeCounters,
  opts: { url?: string; body?: string } = {},
) {
  const page = {
    url: () => opts.url ?? 'https://example.com/',
    goto: async () => undefined,
    content: async () => '<html></html>',
    innerText: async () => opts.body ?? 'text',
    click: async () => {},
    fill: async () => {},
    mouse: { click: async () => {}, move: async () => {} },
    screenshot: async () => Buffer.from(''),
    evaluate: async <T>(): Promise<T> => (opts.body ?? 'visible page text') as unknown as T,
  };
  const context = {
    newPage: async () => page,
    route: async (pattern: string, handler: (route: unknown) => void | Promise<void>) => {
      counters.routePatterns.push(pattern);
      counters.routeHandler = handler;
    },
  };
  const browser = {
    newContext: async () => context,
    close: async () => {
      counters.closes += 1;
    },
  };
  return {
    chromium: {
      launch: async () => {
        counters.launches += 1;
        return browser;
      },
    },
  };
}

/** A fake Playwright Route with fulfill/abort/continue spies + a request() whose
 *  url()/method()/postData()/headers() are configurable — drives the new
 *  fetch-and-fulfill interceptor without a real browser. */
function fakeRoute(req: { url: string; method?: string; postData?: string | null; headers?: Record<string, string> }) {
  const fulfill = vi.fn(async (_opts: { status?: number; headers?: Record<string, string>; body?: Buffer | string }) => {});
  const abort = vi.fn(async () => {});
  const cont = vi.fn(async () => {});
  return {
    fulfill,
    abort,
    continue: cont,
    request: () => ({
      url: () => req.url,
      method: () => req.method ?? 'GET',
      postData: () => req.postData ?? null,
      headers: () => req.headers ?? {},
    }),
  };
}

function fakeSafeResponse(over: Partial<SafeResponse> = {}): SafeResponse {
  const body = over.body ?? Buffer.from('<html>ok</html>');
  return {
    status: over.status ?? 200,
    headers: over.headers ?? { 'content-type': 'text/html' },
    body,
    url: over.url ?? 'https://example.com/',
    text: () => body.toString('utf8'),
    json: () => JSON.parse(body.toString('utf8')) as unknown,
  };
}

/** Boot a driver against the fake Pw module and return the captured interceptor
 *  handler (installed lazily on first verb). */
async function bootInterceptor(
  counters: FakeCounters,
  fetchImpl: SafeFetchFn,
): Promise<(route: unknown) => void | Promise<void>> {
  const driver = new PlaywrightBrowserDriver(
    isPublicIp,
    async () => fakePwModule(counters) as never,
    fetchImpl,
  );
  await driver.extract(); // triggers ensurePage() → installs the route handler
  if (!counters.routeHandler) throw new Error('interceptor was not installed');
  return counters.routeHandler;
}

/* ── the fetch-and-fulfill interceptor (P2 rebind window closed) ─────────────── */

describe('fetch-and-fulfill interceptor — pinned safeFetch, fail-closed', () => {
  it('an http(s) request to a public host → safeFetch is called and route.fulfill serves the bytes (no continue/abort)', async () => {
    const counters: FakeCounters = { launches: 0, closes: 0, routePatterns: [] };
    const fetchImpl = vi.fn<SafeFetchFn>(async () => fakeSafeResponse({ status: 200, body: Buffer.from('PINNED BODY') }));
    const handler = await bootInterceptor(counters, fetchImpl);

    const route = fakeRoute({ url: 'https://example.com/page' });
    await handler(route);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(route.fulfill).toHaveBeenCalledTimes(1);
    const fulfillArg = route.fulfill.mock.calls[0]![0] as { status: number; body: Buffer };
    expect(fulfillArg.status).toBe(200);
    expect(fulfillArg.body.toString('utf8')).toBe('PINNED BODY');
    expect(route.abort).not.toHaveBeenCalled();
    expect(route.continue).not.toHaveBeenCalled();
  });

  it('a request whose safeFetch throws EgressDeniedError(private-ip) → route.abort(), never fulfilled', async () => {
    const counters: FakeCounters = { launches: 0, closes: 0, routePatterns: [] };
    const fetchImpl = vi.fn<SafeFetchFn>(async () => {
      throw new EgressDeniedError('private-ip', 'rebind to 169.254.169.254');
    });
    const handler = await bootInterceptor(counters, fetchImpl);

    const route = fakeRoute({ url: 'https://rebind.example/' });
    await handler(route);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(route.abort).toHaveBeenCalledTimes(1);
    expect(route.fulfill).not.toHaveBeenCalled();
    expect(route.continue).not.toHaveBeenCalled();
  });

  it('a size/timeout cut on the pinned fetch also FAILS CLOSED → route.abort()', async () => {
    const counters: FakeCounters = { launches: 0, closes: 0, routePatterns: [] };
    for (const reason of ['size', 'timeout']) {
      const fetchImpl = vi.fn<SafeFetchFn>(async () => {
        throw new EgressDeniedError(reason, `cut: ${reason}`);
      });
      const handler = await bootInterceptor(counters, fetchImpl);
      const route = fakeRoute({ url: 'https://huge.example/' });
      await handler(route);
      expect(route.abort).toHaveBeenCalledTimes(1);
      expect(route.fulfill).not.toHaveBeenCalled();
    }
  });

  it('a data:/about: URL → route.continue() and safeFetch is NOT called (no SSRF vector)', async () => {
    const counters: FakeCounters = { launches: 0, closes: 0, routePatterns: [] };
    const fetchImpl = vi.fn<SafeFetchFn>(async () => fakeSafeResponse());
    const handler = await bootInterceptor(counters, fetchImpl);

    for (const url of ['data:text/html,<p>hi</p>', 'about:blank']) {
      const route = fakeRoute({ url });
      await handler(route);
      expect(route.continue).toHaveBeenCalledTimes(1);
      expect(route.fulfill).not.toHaveBeenCalled();
      expect(route.abort).not.toHaveBeenCalled();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('credential headers (cookie/authorization) are STRIPPED from what safeFetch receives; benign headers forwarded', async () => {
    const counters: FakeCounters = { launches: 0, closes: 0, routePatterns: [] };
    const fetchImpl = vi.fn<SafeFetchFn>(async () => fakeSafeResponse());
    const handler = await bootInterceptor(counters, fetchImpl);

    const route = fakeRoute({
      url: 'https://example.com/',
      method: 'POST',
      postData: '{"q":1}',
      headers: {
        cookie: 'session=secret',
        Authorization: 'Bearer LEAK',
        'proxy-authorization': 'Basic LEAK',
        'user-agent': 'NibbinBot',
        accept: 'text/html',
        'content-type': 'application/json',
      },
    });
    await handler(route);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0]![1] as { method: string; headers: Record<string, string>; body?: string };
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"q":1}');
    // credentials dropped
    expect(init.headers).not.toHaveProperty('cookie');
    expect(init.headers).not.toHaveProperty('authorization');
    expect(init.headers).not.toHaveProperty('proxy-authorization');
    // benign forwarded (lowercased)
    expect(init.headers['user-agent']).toBe('NibbinBot');
    expect(init.headers['accept']).toBe('text/html');
    expect(init.headers['content-type']).toBe('application/json');
    // http option only set for http: (this is https:)
    const httpOpt = fetchImpl.mock.calls[0]![3] as { allowHttp?: boolean } | undefined;
    expect(httpOpt?.allowHttp).toBeUndefined();
    expect(route.fulfill).toHaveBeenCalledTimes(1);
  });

  it('an http: request passes allowHttp to safeFetch (parity with the navigate probe)', async () => {
    const counters: FakeCounters = { launches: 0, closes: 0, routePatterns: [] };
    const fetchImpl = vi.fn<SafeFetchFn>(async () => fakeSafeResponse());
    const handler = await bootInterceptor(counters, fetchImpl);

    const route = fakeRoute({ url: 'http://plain.example/' });
    await handler(route);

    const httpOpt = fetchImpl.mock.calls[0]![3] as { allowHttp?: boolean };
    expect(httpOpt.allowHttp).toBe(true);
    expect(route.fulfill).toHaveBeenCalledTimes(1);
  });
});

describe('PlaywrightBrowserDriver — launch ↔ close lifecycle (fake Pw)', () => {
  it('launches lazily on first use and closes exactly once; installs the route interceptor', async () => {
    const counters: FakeCounters = { launches: 0, closes: 0, routePatterns: [] };
    const driver = new PlaywrightBrowserDriver(isPublicIp, async () => fakePwModule(counters) as never);

    // Not launched until first verb. (We exercise lazy launch via `extract`,
    // which does NOT run the navigate safeFetch probe — so no real egress.)
    expect(counters.launches).toBe(0);

    const read = await driver.extract();
    expect(counters.launches).toBe(1);
    // the per-request egress interceptor is installed on the context
    expect(counters.routePatterns).toContain('**');
    expect(isQuarantined(read.content.wrapped)).toBe(true);

    // a second verb reuses the same browser (no relaunch)
    await driver.extract({ selector: '#x' });
    expect(counters.launches).toBe(1);

    await driver.close();
    expect(counters.closes).toBe(1);

    // close() is idempotent + best-effort
    await driver.close();
    expect(counters.closes).toBe(1);
  });

  it('a READ verb whose page moved to an internal URL returns a clean blocked observation, NOT content', async () => {
    const counters: FakeCounters = { launches: 0, closes: 0, routePatterns: [] };
    // page.url() reports an internal URL (as if a JS redirect moved it since nav).
    const driver = new PlaywrightBrowserDriver(
      isPublicIp,
      async () => fakePwModule(counters, { url: 'http://169.254.169.254/latest/meta-data/', body: 'SECRET METADATA' }) as never,
    );
    const out = await driver.extract();
    expect(out.content.wrapped.toLowerCase()).toContain('blocked');
    // the page body must NOT have leaked into the observation
    expect(out.content.wrapped).not.toContain('SECRET METADATA');
    expect(isQuarantined(out.content.wrapped)).toBe(true);
  });
});

/* ── quarantine cap alignment + verb-arg behavior (claims P3) ───────────────── */

describe('quarantine cap stays well-formed (page <= observation budget)', () => {
  it('a huge page is capped and the wrapped quarantine remains well-formed', async () => {
    const counters: FakeCounters = { launches: 0, closes: 0, routePatterns: [] };
    const driver = new PlaywrightBrowserDriver(
      isPublicIp,
      async () => fakePwModule(counters, { body: 'A'.repeat(50_000) }) as never,
    );
    const out = await driver.extract();
    // OBSERVATION_MAX_CHARS in the harness is 4000 — the page cap keeps the WHOLE
    // wrapped quarantine under it so the closing marker is never sliced off.
    expect(out.content.wrapped.length).toBeLessThan(4000);
    expect(isQuarantined(out.content.wrapped)).toBe(true);
  });
});

describe('computer_use verb-arg validation (claims P3)', () => {
  it('rejects a partial coordinate target ({x} without y)', () => {
    expect(() => validateTarget({ x: 10 })).toThrow();
    expect(() => validateTarget({ y: 10 })).toThrow();
    expect(() => validateComputerUseArgs('click', { target: { x: 10 } })).toThrow();
  });

  it('screenshot yields quarantined TEXT (OCR/a11y surrogate), never raw bytes', async () => {
    const counters: FakeCounters = { launches: 0, closes: 0, routePatterns: [] };
    const driver = new PlaywrightBrowserDriver(isPublicIp, async () => fakePwModule(counters) as never);
    const shot = await driver.screenshot();
    expect(shot.kind).toBe('read');
    expect(typeof shot.content.wrapped).toBe('string');
    expect(isQuarantined(shot.content.wrapped)).toBe(true);
    // it is text, not a Buffer/base64 blob
    expect(Buffer.isBuffer(shot.content as unknown)).toBe(false);
  });
});
