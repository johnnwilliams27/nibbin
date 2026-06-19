import 'server-only';

/**
 * The computer_use (browser) wiring for apps/web (design §4 / R9).
 *
 *  - `browserEnabled()` — the env flag gating the WHOLE surface. The browser is
 *    offered to the Planner ONLY when `COMPUTER_USE_ENABLED` is truthy AND a
 *    Playwright runtime is actually present. Off by default (and off on this
 *    machine / in CI): a real browser is never launched without the flag.
 *  - `buildBrowserDriver()` — returns a live Playwright-backed driver when the
 *    flag is on and the package loads, else `undefined` (the harness then
 *    surfaces a clean "browser unavailable" observation — it never throws).
 *  - The navigate SSRF guard reuses the SAME public-IP predicate web.fetch uses
 *    (`isPublicIp` from @nibbin/connectors), passed into the harness via
 *    PlannerDeps.isPublicIp.
 *
 * IMPORTANT: `playwright` is an OPTIONAL, NOT-INSTALLED dependency here. We load
 * it via a runtime dynamic import of a non-statically-analyzable specifier so
 * the build never tries to resolve it; if it isn't present, the driver is simply
 * unavailable. All tests use the in-memory MockBrowserDriver from @nibbin/runtime.
 *
 * Egress posture (the load-bearing SSRF defense — P0/P1/P2):
 *  - The throwaway `safeFetch` probe in `navigate` is a cheap PRE-check only; it
 *    is NOT the security decision (a separate, unpinned `page.goto` re-resolves
 *    DNS independently, so the probe alone is bypassable by a redirect / JS
 *    redirect / DNS rebind).
 *  - The LOAD-BEARING guard is `context.route('**', …)`: EVERY request the
 *    Chromium context makes (the main navigation, every redirect hop, AND every
 *    subresource) is intercepted, its host resolved, and ABORTED unless the
 *    resolved IP is public. This validates redirects, JS-redirects, DNS-rebinds
 *    and subresource fetches at the browser layer, where they actually happen.
 *  - The READ verbs (extract/screenshot/scroll) additionally re-assert
 *    `assertSafeNavigateUrl(page.url())` before returning content: the page may
 *    have moved (redirect/JS) since `navigate`, so we refuse to surface content
 *    from a now-internal URL.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import {
  quarantine,
  isPublicIp as connectorsIsPublicIp,
  safeFetch,
  EgressDeniedError,
} from '@nibbin/connectors';
import {
  assertSafeNavigateUrl,
  describeTarget,
  type BrowserDriver,
  type BrowserDraftResult,
  type BrowserReadResult,
  type BrowserTarget,
} from '@nibbin/runtime';

/** The public-IP predicate the navigate SSRF guard uses (same as web.fetch). */
export const browserIsPublicIp = connectorsIsPublicIp;

/** Truthy COMPUTER_USE_ENABLED gates the whole surface. Off by default. */
export function browserEnabled(): boolean {
  const v = process.env.COMPUTER_USE_ENABLED;
  return typeof v === 'string' && (v === '1' || v.toLowerCase() === 'true');
}

/**
 * Hard caps so a hostile/huge page can never blow the loop budget. The page cap
 * MUST stay <= the harness's OBSERVATION_MAX_CHARS (4000) so a wrapped
 * quarantine is never sliced mid-payload (which would drop the closing marker
 * and break `isQuarantined`). The quarantine wrapper adds a small fixed prefix/
 * suffix, so we cap the raw body comfortably under that budget.
 */
const PAGE_MAX_CHARS = 3_500;
const NAV_TIMEOUT_MS = 15_000;

/**
 * The minimal Playwright surface we use — typed locally so we never need the
 * `@playwright/test` / `playwright` types at build time (the package is not a
 * declared dependency). The dynamic import is cast to this shape.
 */
interface PwRoute {
  request(): { url(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
}
interface PwPage {
  url(): string;
  goto(url: string, opts?: { timeout?: number; waitUntil?: string }): Promise<unknown>;
  content(): Promise<string>;
  innerText(selector: string, opts?: { timeout?: number }): Promise<string>;
  click(selector: string, opts?: { timeout?: number }): Promise<void>;
  fill(selector: string, value: string, opts?: { timeout?: number }): Promise<void>;
  mouse: { click(x: number, y: number): Promise<void>; move(x: number, y: number): Promise<void> };
  screenshot(opts?: Record<string, unknown>): Promise<Buffer>;
  evaluate<T>(fn: () => T): Promise<T>;
}
interface PwContext {
  newPage(): Promise<PwPage>;
  route(pattern: string, handler: (route: PwRoute) => void | Promise<void>): Promise<void>;
}
interface PwBrowser { newContext(): Promise<PwContext>; close(): Promise<void> }
interface PwModule { chromium: { launch(opts?: Record<string, unknown>): Promise<PwBrowser> } }

/** Load playwright at runtime WITHOUT a static module reference (so the build
 *  never resolves the absent package). Returns null if it isn't installed. */
async function loadPlaywright(): Promise<PwModule | null> {
  try {
    // The specifier is held in a variable so bundler/tsc static analysis can't
    // try to resolve `playwright` at build time.
    const spec = ['play', 'wright'].join('');
    const mod = (await import(/* webpackIgnore: true */ spec)) as unknown as PwModule;
    return mod && mod.chromium ? mod : null;
  } catch {
    return null;
  }
}

function capPage(text: string): string {
  return text.length > PAGE_MAX_CHARS ? `${text.slice(0, PAGE_MAX_CHARS)}…[truncated]` : text;
}

/**
 * The per-request egress decision for the Chromium interceptor (the LOAD-BEARING
 * SSRF guard). Resolve the request's host and decide allow/abort: an http(s) URL
 * to a host that resolves ONLY to public IPs is allowed; anything else (non-http,
 * credentials, a literal/resolved private/loopback/link-local/metadata IP, a DNS
 * failure) is aborted. Mirrors safeFetch's "one private answer poisons the set"
 * rule so a split-horizon / rebind answer can't slip a private IP past us.
 *
 * Exported so the validation LOGIC is unit-testable without a real browser.
 */
export async function isRequestEgressAllowed(
  rawUrl: string,
  isPublicIp: (addr: string) => boolean = browserIsPublicIp,
  lookup: (host: string) => Promise<Array<{ address: string }>> = async (h) => {
    const found = await dnsLookup(h, { all: true, verbatim: true });
    return found.map((f) => ({ address: f.address }));
  },
): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === '') return false;
  // Internal-suffix hosts (localhost/.local/.internal) never resolve to a public
  // answer we'd want to reach — reject without a lookup.
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return false;
  }
  const isLiteral = host.includes(':') || /^\d+(\.\d+){3}$/.test(host) || /^\d+$/.test(host);
  if (isLiteral) return isPublicIp(host);
  // A name: resolve every answer; ONE private answer poisons the whole set.
  let answers: Array<{ address: string }>;
  try {
    answers = await lookup(host);
  } catch {
    return false;
  }
  if (answers.length === 0) return false;
  return answers.every((a) => isPublicIp(a.address));
}

/**
 * A Playwright-backed BrowserDriver. Constructed lazily (the browser+context+page
 * are launched on first use). READ verbs return quarantined page text. WRITE
 * verbs (click/type) are described but NOT performed (the harness pauses for
 * approval); `commit` performs the already-approved verb.
 *
 * SSRF defense (per-request interception is the load-bearing guard):
 *  - On context creation we install `context.route('**', …)`: EVERY request
 *    (main nav, redirects, subresources) is resolved + aborted unless public.
 *  - `navigate` additionally runs a cheap safeFetch PRE-check that fails CLOSED
 *    (gated on the EgressDeniedError.reason enum: a private-ip/allowlist/dns/
 *    userinfo/protocol/port denial is a hard refusal; only a size/timeout cut —
 *    which still PROVES a public host was reached — is allowed to fall through).
 *  - READ verbs re-assert `assertSafeNavigateUrl(page.url())` before returning,
 *    so a page that moved to an internal URL since navigate yields a clean
 *    blocked observation instead of content.
 */
export class PlaywrightBrowserDriver implements BrowserDriver {
  private pw: PwModule | null = null;
  private browser: PwBrowser | null = null;
  private context: PwContext | null = null;
  private page: PwPage | null = null;

  /**
   * @param isPublicIp the egress predicate (apps/web passes the connectors one).
   * @param loadModule TEST-ONLY seam — injects a fake PwModule so the lifecycle/
   *   interception LOGIC is exercisable without a real Chromium. Production omits
   *   it and the real (absent-by-default) dynamic import is used.
   */
  constructor(
    private readonly isPublicIp: (addr: string) => boolean = browserIsPublicIp,
    private readonly loadModule: () => Promise<PwModule | null> = loadPlaywright,
  ) {}

  private async ensurePage(): Promise<PwPage> {
    if (this.page) return this.page;
    this.pw ??= await this.loadModule();
    if (!this.pw) throw new Error('playwright is not installed');
    this.browser ??= await this.pw.chromium.launch({ headless: true });
    this.context = await this.browser.newContext();
    // LOAD-BEARING: validate Chromium's ACTUAL egress per request. Every request
    // the context makes — main navigation, redirects, AND subresources — is
    // resolved and aborted unless it resolves to a public IP. This is what closes
    // the redirect / JS-redirect / DNS-rebind / subresource SSRF holes that the
    // throwaway navigate probe cannot.
    await this.context.route('**', async (route) => {
      const url = route.request().url();
      try {
        const allowed = await isRequestEgressAllowed(url, this.isPublicIp);
        if (allowed) await route.continue();
        else await route.abort();
      } catch {
        await route.abort();
      }
    });
    this.page = await this.context.newPage();
    return this.page;
  }

  private read(body: string, source: string): BrowserReadResult {
    return { kind: 'read', content: quarantine(capPage(body), source) };
  }

  /** A clean quarantined "blocked" read — never page content. */
  private blocked(reason: string): BrowserReadResult {
    return { kind: 'read', content: quarantine(`blocked: ${reason}`, 'browser:blocked') };
  }

  /**
   * Re-assert the URL guard before surfacing content from a READ verb: the page
   * may have moved (redirect/JS) since navigate, so a now-internal current URL
   * must NOT return content. Returns null when the current URL is safe.
   */
  private guardCurrentUrl(page: PwPage): BrowserReadResult | null {
    let current: string;
    try {
      current = page.url();
    } catch {
      return this.blocked('the page URL could not be read');
    }
    // about:blank etc. carry no content and are not an egress target.
    if (!current || current === 'about:blank') return null;
    try {
      assertSafeNavigateUrl(current, this.isPublicIp);
      return null;
    } catch (err) {
      return this.blocked(`the page is now at a non-public URL — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async navigate(url: string): Promise<BrowserReadResult> {
    // Cheap PRE-check: resolve+pin via the connector egress proxy. A private
    // answer / rebind raises EgressDeniedError → we FAIL CLOSED on any denial
    // reason except size/timeout (which prove a public host WAS reached). The
    // load-bearing guard is still the per-request interceptor installed in
    // ensurePage(); this just rejects the obvious cases before launching nav.
    try {
      await safeFetch(
        url,
        { method: 'GET' },
        { timeoutMs: NAV_TIMEOUT_MS, maxResponseBytes: 1 },
        { ...(new URL(url).protocol === 'http:' ? { allowHttp: true } : {}) },
      );
    } catch (err) {
      if (err instanceof EgressDeniedError) {
        // Fail-closed: only a size/timeout cut proves a public host was reached.
        // Any other reason (private-ip, allowlist, dns, userinfo, protocol, port,
        // network, redirect) is a hard refusal.
        if (err.reason !== 'size' && err.reason !== 'timeout') {
          throw new Error(`navigate blocked: ${err.message}`);
        }
      } else {
        // A non-EgressDeniedError (e.g. a bad URL) is also a refusal.
        throw err instanceof Error ? err : new Error(String(err));
      }
    }
    const page = await this.ensurePage();
    await page.goto(url, { timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
    // The interceptor may have aborted a redirect to an internal host — re-assert.
    const moved = this.guardCurrentUrl(page);
    if (moved) return moved;
    const text = await page.evaluate(() => document.body?.innerText ?? '');
    return this.read(text, `browser:${new URL(url).host}`);
  }

  async extract(target?: BrowserTarget): Promise<BrowserReadResult> {
    const page = await this.ensurePage();
    const moved = this.guardCurrentUrl(page);
    if (moved) return moved;
    if (target?.selector) {
      const text = await page.innerText(target.selector, { timeout: 5_000 }).catch(() => '');
      return this.read(text, `browser:extract:${target.selector}`);
    }
    const text = await page.evaluate(() => document.body?.innerText ?? '');
    return this.read(text, 'browser:extract');
  }

  async screenshot(): Promise<BrowserReadResult> {
    const page = await this.ensurePage();
    const moved = this.guardCurrentUrl(page);
    if (moved) return moved;
    // We do NOT ship raw pixels to the model — we return a quarantined text
    // description (page title + visible text) as the OCR/a11y surrogate.
    const text = await page.evaluate(() => `${document.title}\n${document.body?.innerText ?? ''}`);
    return this.read(text, 'browser:screenshot');
  }

  async scroll(): Promise<BrowserReadResult> {
    const page = await this.ensurePage();
    const moved = this.guardCurrentUrl(page);
    if (moved) return moved;
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    const text = await page.evaluate(() => document.body?.innerText ?? '');
    return this.read(text, 'browser:scroll');
  }

  async click(target: BrowserTarget): Promise<BrowserDraftResult> {
    return { kind: 'draft', summary: `click ${describeTarget(target)}` };
  }
  async type(target: BrowserTarget, value: string): Promise<BrowserDraftResult> {
    return { kind: 'draft', summary: `type ${JSON.stringify(value)} into ${describeTarget(target)}` };
  }

  async commit(verb: 'click' | 'type', target: BrowserTarget, value?: string): Promise<void> {
    const page = await this.ensurePage();
    if (verb === 'click') {
      if (target.selector) await page.click(target.selector, { timeout: 5_000 });
      else if (typeof target.x === 'number' && typeof target.y === 'number') await page.mouse.click(target.x, target.y);
      return;
    }
    // type
    if (target.selector) await page.fill(target.selector, value ?? '', { timeout: 5_000 });
    else throw new Error('type requires a selector target to fill');
  }

  /** Tear down Chromium so a pause/resume / terminal outcome leaves no orphaned
   *  process. Idempotent + best-effort (never throws into the caller). */
  async close(): Promise<void> {
    const browser = this.browser;
    this.page = null;
    this.context = null;
    this.browser = null;
    if (browser) {
      try {
        await browser.close();
      } catch {
        // best-effort: a failed close must not surface as a run error.
      }
    }
  }
}

/**
 * Build the live BrowserDriver for a run, or `undefined` when the surface is
 * off (flag unset) or Playwright isn't installed. `undefined` → the harness
 * surfaces "browser unavailable" cleanly (never throws).
 */
export async function buildBrowserDriver(): Promise<BrowserDriver | undefined> {
  if (!browserEnabled()) return undefined;
  const pw = await loadPlaywright();
  if (!pw) return undefined;
  return new PlaywrightBrowserDriver();
}
