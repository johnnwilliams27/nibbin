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
 */
import {
  quarantine,
  isPublicIp as connectorsIsPublicIp,
  safeFetch,
  EgressDeniedError,
} from '@nibbin/connectors';
import {
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

/** Hard caps so a hostile/huge page can never blow the loop budget. */
const PAGE_MAX_CHARS = 8_000;
const NAV_TIMEOUT_MS = 15_000;

/**
 * The minimal Playwright surface we use — typed locally so we never need the
 * `@playwright/test` / `playwright` types at build time (the package is not a
 * declared dependency). The dynamic import is cast to this shape.
 */
interface PwPage {
  goto(url: string, opts?: { timeout?: number; waitUntil?: string }): Promise<unknown>;
  content(): Promise<string>;
  innerText(selector: string, opts?: { timeout?: number }): Promise<string>;
  click(selector: string, opts?: { timeout?: number }): Promise<void>;
  fill(selector: string, value: string, opts?: { timeout?: number }): Promise<void>;
  mouse: { click(x: number, y: number): Promise<void>; move(x: number, y: number): Promise<void> };
  screenshot(opts?: Record<string, unknown>): Promise<Buffer>;
  evaluate<T>(fn: () => T): Promise<T>;
}
interface PwBrowser { newPage(): Promise<PwPage>; close(): Promise<void> }
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
 * A Playwright-backed BrowserDriver. Constructed lazily (the page is launched on
 * first use). READ verbs return quarantined page text. WRITE verbs (click/type)
 * are described but NOT performed (the harness pauses for approval); `commit`
 * performs the already-approved verb.
 *
 * The navigate egress posture mirrors web.fetch: the harness has already run the
 * literal-host SSRF pre-filter (assertSafeNavigateUrl), and we additionally do a
 * safeFetch HEAD-class resolve+pin check of the host BEFORE handing the URL to
 * the headless browser, so a public hostname that resolves to a private IP
 * (DNS rebinding) is rejected before navigation.
 */
class PlaywrightBrowserDriver implements BrowserDriver {
  private pw: PwModule | null = null;
  private browser: PwBrowser | null = null;
  private page: PwPage | null = null;

  private async ensurePage(): Promise<PwPage> {
    if (this.page) return this.page;
    this.pw ??= await loadPlaywright();
    if (!this.pw) throw new Error('playwright is not installed');
    this.browser ??= await this.pw.chromium.launch({ headless: true });
    this.page = await this.browser.newPage();
    return this.page;
  }

  private read(body: string, source: string): BrowserReadResult {
    return { kind: 'read', content: quarantine(capPage(body), source) };
  }

  async navigate(url: string): Promise<BrowserReadResult> {
    // Rebind defense before navigation: resolve+pin via the connector egress
    // proxy. A private answer / rebind raises EgressDeniedError → rejected.
    try {
      await safeFetch(url, { method: 'GET' }, { timeoutMs: NAV_TIMEOUT_MS, maxResponseBytes: 1 },
        { ...(new URL(url).protocol === 'http:' ? { allowHttp: true } : {}) });
    } catch (err) {
      if (err instanceof EgressDeniedError && /private-ip|allowlist|dns/.test(err.message)) {
        throw new Error(`navigate blocked: ${err.message}`);
      }
      // a size/timeout cut on the probe is fine — the host resolved public.
    }
    const page = await this.ensurePage();
    await page.goto(url, { timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
    const text = await page.evaluate(() => document.body?.innerText ?? '');
    return this.read(text, `browser:${new URL(url).host}`);
  }

  async extract(target?: BrowserTarget): Promise<BrowserReadResult> {
    const page = await this.ensurePage();
    if (target?.selector) {
      const text = await page.innerText(target.selector, { timeout: 5_000 }).catch(() => '');
      return this.read(text, `browser:extract:${target.selector}`);
    }
    const text = await page.evaluate(() => document.body?.innerText ?? '');
    return this.read(text, 'browser:extract');
  }

  async screenshot(): Promise<BrowserReadResult> {
    const page = await this.ensurePage();
    // We do NOT ship raw pixels to the model — we return a quarantined text
    // description (page title + visible text) as the OCR/a11y surrogate.
    const text = await page.evaluate(() => `${document.title}\n${document.body?.innerText ?? ''}`);
    return this.read(text, 'browser:screenshot');
  }

  async scroll(): Promise<BrowserReadResult> {
    const page = await this.ensurePage();
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
