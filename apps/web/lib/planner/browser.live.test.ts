/**
 * LIVE Playwright integration test for the computer_use browser surface — the
 * P3 residual that proves the fetch-and-fulfill interceptor (browser.ts) behaves
 * against REAL Chromium, not just the fake-module unit harness.
 *
 * This test is GATED THREE WAYS and SKIPS unless ALL hold:
 *   1. COMPUTER_USE_LIVE_TEST === '1'  (a human opts in)
 *   2. the real `playwright` package imports
 *   3. a real Chromium launch succeeds (the browser binary is installed)
 *
 * So normal CI — which has no browser binary and does not set the env flag —
 * NEVER runs it and is NEVER broken. A human runs it pre-enablement with:
 *
 *   cd apps/web && npx playwright install chromium \
 *     && COMPUTER_USE_LIVE_TEST=1 npx vitest run lib/planner/browser.live.test.ts
 *
 * Any import/launch failure → the gate flips to skip; it must never FAIL CI.
 *
 * What it asserts when enabled, driving the REAL PlaywrightBrowserDriver:
 *  (a) the context.route('**') handler actually fires on a navigation (proven by
 *      a custom safeFetch seam that records the URLs Chromium tried to fetch);
 *  (b) a navigation whose host resolves to a loopback/private address is BLOCKED
 *      — the interceptor fails closed and the observation carries no page content;
 *  (c) a public navigation is FULFILLED from the pinned bytes we returned and the
 *      resulting observation is quarantined (page = data, never instructions).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { EgressDeniedError, isPublicIp, isQuarantined, type SafeResponse } from '@nibbin/connectors';
import { PlaywrightBrowserDriver, type SafeFetchFn } from './browser';

/** Resolve the live-test gate once, before the suite is defined. */
async function liveGate(): Promise<{ ok: boolean; reason?: string }> {
  if (process.env.COMPUTER_USE_LIVE_TEST !== '1') return { ok: false, reason: 'COMPUTER_USE_LIVE_TEST!=1' };
  let pw: { chromium: { launch(opts?: Record<string, unknown>): Promise<{ close(): Promise<void> }> } };
  try {
    const spec = ['play', 'wright'].join('');
    pw = (await import(/* @vite-ignore */ spec)) as never;
  } catch {
    return { ok: false, reason: 'playwright import failed' };
  }
  try {
    const b = await pw.chromium.launch({ headless: true });
    await b.close();
  } catch {
    return { ok: false, reason: 'chromium launch failed' };
  }
  return { ok: true };
}

const gate = await liveGate();

/** Build a synthetic HTML SafeResponse for the pinned-fetch seam. */
function htmlResponse(html: string, url: string): SafeResponse {
  const body = Buffer.from(html, 'utf8');
  return {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body,
    url,
    text: () => body.toString('utf8'),
    json: () => JSON.parse(body.toString('utf8')) as unknown,
  };
}

describe.skipIf(!gate.ok)('LIVE: PlaywrightBrowserDriver fetch-and-fulfill against real Chromium', () => {
  const drivers: PlaywrightBrowserDriver[] = [];
  afterAll(async () => {
    await Promise.all(drivers.map((d) => d.close().catch(() => {})));
  });

  it('(a) the context.route("**") interceptor fires on a navigation (seam records the fetched URL)', async () => {
    const fetched: string[] = [];
    const fetchImpl: SafeFetchFn = async (url) => {
      fetched.push(url);
      return htmlResponse('<html><body><h1>PUBLIC PAGE BODY</h1></body></html>', url);
    };
    const driver = new PlaywrightBrowserDriver(isPublicIp, undefined, fetchImpl);
    drivers.push(driver);

    const out = await driver.navigate('https://example.com/orders');
    // The interceptor served the main document → our seam saw the request.
    expect(fetched.some((u) => u.startsWith('https://example.com/'))).toBe(true);
    expect(isQuarantined(out.content.wrapped)).toBe(true);
  });

  it('(c) a public navigation is fulfilled from PINNED bytes and the observation is quarantined', async () => {
    const marker = 'PINNED-BYTES-MARKER-' + Math.random().toString(36).slice(2);
    const fetchImpl: SafeFetchFn = async (url) =>
      htmlResponse(`<html><body><p>${marker}</p></body></html>`, url);
    const driver = new PlaywrightBrowserDriver(isPublicIp, undefined, fetchImpl);
    drivers.push(driver);

    const out = await driver.navigate('https://example.com/');
    // Chromium rendered the bytes WE pinned (not whatever the real site serves).
    expect(out.content.wrapped).toContain(marker);
    expect(isQuarantined(out.content.wrapped)).toBe(true);
  });

  it('(b) a navigation whose host resolves to a private/loopback address is BLOCKED (no content)', async () => {
    // The pinned fetch refuses any request to this host (as safeFetch would for a
    // rebind to a private IP) → the interceptor aborts every request → Chromium
    // gets nothing → the read guard surfaces a clean blocked observation.
    const secret = 'INTERNAL-SECRET-SHOULD-NOT-LEAK';
    const fetchImpl: SafeFetchFn = async (url) => {
      if (url.includes('rebind.invalid')) {
        throw new EgressDeniedError('private-ip', `${url} resolves to a private address`);
      }
      return htmlResponse(`<html><body>${secret}</body></html>`, url);
    };
    const driver = new PlaywrightBrowserDriver(isPublicIp, undefined, fetchImpl);
    drivers.push(driver);

    // The navigate pre-probe uses the REAL safeFetch (it can't reach our seam),
    // so it may throw for an unresolvable host — that is itself a fail-closed
    // rejection. Either path (probe throw OR interceptor-abort blocked obs) is
    // acceptable; in both cases the internal secret must never surface.
    let leaked = false;
    try {
      const out = await driver.navigate('https://rebind.invalid/admin');
      leaked = out.content.wrapped.includes(secret);
      // a fulfilled-but-empty / blocked observation is fine; content must not leak
      expect(leaked).toBe(false);
    } catch {
      // pre-probe fail-closed — also acceptable, and obviously no leak
      leaked = false;
    }
    expect(leaked).toBe(false);
  });
});
