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
 *  - The LOAD-BEARING guard is `context.route('**', …)`: EVERY http(s) request
 *    the Chromium context makes (the main navigation, every redirect hop, AND
 *    every subresource) is intercepted and FETCHED-AND-FULFILLED through the
 *    pinned `safeFetch` (DNS-validated + TCP-pinned + per-hop re-checked); the
 *    response bytes are replayed via `route.fulfill` with framing/hop-by-hop/
 *    set-cookie headers stripped (content-encoding kept — see
 *    sanitizeResponseHeaders). Chromium never opens its own socket to a host, so
 *    the DNS-rebind window is STRUCTURALLY closed for HTTP requests. WebSocket
 *    handshakes and Service-Worker fetches bypass `context.route` entirely, so
 *    they are blocked at context creation (`serviceWorkers: 'block'` +
 *    `routeWebSocket('**', ws => ws.close())`) — closing the rebind class for
 *    ALL request types, not just HTTP.
 *  - The READ verbs (extract/screenshot/scroll) additionally re-assert
 *    `assertSafeNavigateUrl(page.url())` before returning content: the page may
 *    have moved (redirect/JS) since `navigate`, so we refuse to surface content
 *    from a now-internal URL.
 */
import {
  quarantine,
  isPublicIp as connectorsIsPublicIp,
  safeFetch,
  EgressDeniedError,
  type SafeResponse,
  type SafeFetchInit,
  type EgressPolicy,
  type UnsafeTestOverrides,
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
 * Generous per-request body cap for the fetch-and-fulfill interceptor. A page +
 * its subresources can be large; this matches the connector's own default
 * (`DEFAULT_MAX_BYTES`, 5 MB) so a normal page is fully retrievable over the
 * pinned connection. If a response exceeds it (or times out) the interceptor
 * cannot serve the full body safely → it ABORTS (fail closed).
 */
const EGRESS_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Benign request headers we forward to the pinned fetch. Anything not in this
 * set — crucially the credential headers (`cookie`, `authorization`,
 * `proxy-authorization`) — is DROPPED: a fresh, cookieless context must never
 * forward ambient credentials to an arbitrary host.
 *
 * SECURITY — DO NOT add `cookie` or `authorization` here. The request-side strip
 * is what keeps a response `set-cookie` harmless: Chromium may store the cookie
 * in the throwaway context, but because we never forward `cookie`/`authorization`
 * outbound, that cookie is never replayed to any host. Adding either name here
 * would re-open a credential-exfil channel (ambient creds → arbitrary host) and
 * undo the cookie/credential non-forwarding guarantee.
 */
const FORWARDABLE_HEADERS = new Set([
  'user-agent',
  'accept',
  'accept-language',
  'content-type',
]);

/**
 * Response headers we MUST strip before replaying the origin's response to
 * Chromium via `route.fulfill`. `safeFetch` does ZERO decompression: `resp.body`
 * is the raw socket bytes and `resp.headers` is verbatim from the origin.
 *
 * WHY we KEEP `content-encoding` (and `content-type`/`content-language`/etc.):
 * because the body is still gzip/br-encoded, `content-encoding` MATCHES the
 * bytes. Dropping it while leaving the encoded body would make Chromium try to
 * render compressed bytes as plaintext → garbage.
 *
 * WHY we DROP the framing / hop-by-hop headers: `route.fulfill` recomputes
 * framing (`content-length`, `transfer-encoding`) from the Buffer we hand it.
 * Replaying the origin's `content-length`/`transfer-encoding` verbatim corrupts
 * the response framing (`ERR_CONTENT_LENGTH_MISMATCH` / chunked mismatch).
 * Hop-by-hop headers (`connection`, `keep-alive`, `te`, `trailer`, `upgrade`,
 * `proxy-*`) describe the upstream socket we already terminated — they are
 * meaningless on the fulfilled response. We also drop `set-cookie` as
 * defense-in-depth (a read tool never needs it; the request-side strip already
 * makes any stored cookie unforwardable — see FORWARDABLE_HEADERS).
 */
const STRIPPED_RESPONSE_HEADERS = new Set([
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'te',
  'trailer',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'set-cookie',
]);

/**
 * Strip the framing / hop-by-hop / set-cookie headers from a pinned-fetch
 * response before `route.fulfill` so Playwright recomputes framing from the
 * Buffer. KEEPS `content-encoding` (the body is still encoded — see
 * STRIPPED_RESPONSE_HEADERS). Case-insensitive denylist.
 */
function sanitizeResponseHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!STRIPPED_RESPONSE_HEADERS.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

/**
 * The Signature of the pinned fetch the interceptor calls. Defaults to the
 * connector `safeFetch`; a TEST-ONLY constructor seam can swap it so the
 * fetch-and-fulfill LOGIC is exercisable without real network egress.
 */
export type SafeFetchFn = (
  url: string,
  init?: SafeFetchInit,
  policy?: EgressPolicy,
  unsafeTestOverrides?: UnsafeTestOverrides,
) => Promise<SafeResponse>;

/**
 * Build the credential-stripped, benign-only header set to forward to the
 * pinned fetch from Chromium's per-request headers.
 */
function stripRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (FORWARDABLE_HEADERS.has(k.toLowerCase())) out[k.toLowerCase()] = v;
  }
  return out;
}

/**
 * The minimal Playwright surface we use — typed locally so we never need the
 * `@playwright/test` / `playwright` types at build time (the package is not a
 * declared dependency). The dynamic import is cast to this shape.
 */
interface PwRequest {
  url(): string;
  method(): string;
  postData(): string | null;
  headers(): Record<string, string>;
}
interface PwRoute {
  request(): PwRequest;
  abort(): Promise<void>;
  continue(): Promise<void>;
  fulfill(opts: { status?: number; headers?: Record<string, string>; body?: Buffer | string }): Promise<void>;
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
interface PwWebSocketRoute {
  close(opts?: { code?: number; reason?: string }): void;
}
interface PwContext {
  newPage(): Promise<PwPage>;
  route(pattern: string, handler: (route: PwRoute) => void | Promise<void>): Promise<void>;
  // routeWebSocket exists in Playwright >= 1.48 (the branch pins 1.61). Optional
  // here so the fake-Pw test harness / older builds don't have to provide it.
  routeWebSocket?(pattern: string, handler: (ws: PwWebSocketRoute) => void | Promise<void>): Promise<void>;
}
interface PwBrowser { newContext(opts?: Record<string, unknown>): Promise<PwContext>; close(): Promise<void> }
interface PwModule { chromium: { launch(opts?: Record<string, unknown>): Promise<PwBrowser> } }

/** What `loadBrowserRuntime()` returns: the chromium engine + the launch options
 *  appropriate for the detected runtime (serverless vs local). */
interface BrowserRuntime {
  chromium: PwModule['chromium'];
  launchOptions: Record<string, unknown>;
}

/**
 * Detect a serverless (Vercel / AWS Lambda) runtime. There the stock `playwright`
 * download can't launch — we drive `@sparticuz/chromium`'s bundled binary via
 * `playwright-core`. Anywhere else (local dev / CI) we use full `playwright`'s
 * bundled chromium (today's path).
 */
function isServerlessRuntime(): boolean {
  return Boolean(
    process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_EXECUTION_ENV,
  );
}

/**
 * Load the Playwright ENGINE at runtime WITHOUT a static module reference (so the
 * build never hard-resolves a possibly-absent package). Returns null if nothing
 * loads (→ the driver is simply unavailable; the harness surfaces a clean
 * "browser unavailable").
 *  - Serverless: `playwright-core` (the engine WITHOUT bundled browsers — it
 *    drives the @sparticuz binary; the launch options come from loadBrowserRuntime).
 *  - Local/CI: full `playwright` (bundled chromium, as today); fall back to
 *    `playwright-core` if the full package isn't installed.
 * Each specifier is assembled at runtime so bundler/tsc static analysis can't try
 * to resolve it at build time.
 */
async function loadBrowserEngine(): Promise<PwModule | null> {
  const tryImport = async (spec: string): Promise<PwModule | null> => {
    try {
      const mod = (await import(/* webpackIgnore: true */ spec)) as unknown as PwModule;
      return mod && mod.chromium ? mod : null;
    } catch {
      return null;
    }
  };
  const core = ['playwright', '-core'].join('');
  if (isServerlessRuntime()) {
    // Serverless: prefer the bundled-browser-free engine; if it's somehow absent,
    // try full playwright as a last resort (won't launch without a binary, but the
    // null/throw path is handled the same way).
    return (await tryImport(core)) ?? (await tryImport(['play', 'wright'].join('')));
  }
  // Local/CI: prefer full playwright (bundled chromium); fall back to core.
  return (await tryImport(['play', 'wright'].join(''))) ?? (await tryImport(core));
}

/**
 * Resolve the chromium engine + the launch options for the current runtime, lazily.
 *
 * The ~50 MB @sparticuz chromium layer is imported ONLY here (which is only called
 * from ensurePage, which only runs when a Planner step actually uses computer_use),
 * so the layer never loads on a cold start that doesn't touch the browser.
 *
 * @param loadEngine the engine loader (the constructor seam). When a NON-default
 *   loader is injected (the TEST seam — `loadEngine !== loadBrowserEngine`) we take
 *   the benign `{ headless: true }` launch path and NEVER consult
 *   `isServerlessRuntime()` / import `@sparticuz`, so the fake-Pw unit tests are
 *   HERMETIC regardless of ambient env (a CI runner that sets VERCEL /
 *   AWS_LAMBDA_FUNCTION_NAME / AWS_EXECUTION_ENV would otherwise drive a real
 *   @sparticuz import). Only the real/default loader path consults
 *   `isServerlessRuntime()` + `@sparticuz`.
 *
 * SECURITY — @sparticuz args egress audit (verified against v149 at build time):
 * `chromium.args` is a rendering/sandbox/process-model set
 * (`--single-process`, `--no-sandbox`, gpu/angle/swiftshader, headless, cache size,
 * `--no-pings`, `--disable-domain-reliability`, …). It contains NO `--proxy-server`
 * / `--proxy-pac-url` / `--proxy-bypass-list` (nothing reroutes Chromium's egress
 * away from our interceptor) and NOTHING that disables request interception. The
 * two relaxations it DOES include — `--disable-web-security` and
 * site-isolation-off (`--disable-site-isolation-trials`, `IsolateOrigins` /
 * `site-per-process` in `--disable-features`) — are renderer-side same-origin /
 * process-model relaxations; they do NOT let any renderer open an unpinned socket,
 * because `context.route('**')` fetch-and-fulfill (below) intercepts every http(s)
 * request, `serviceWorkers:'block'` + `routeWebSocket close` cover the
 * uninterceptable classes, and the network decision is made by the pinned
 * `safeFetch`, never by Chromium's CORS checks. `--allow-running-insecure-content`
 * only changes whether Chromium ATTEMPTS a mixed-content subresource — that attempt
 * is still intercepted + fetched over the pinned connection. So the args do not
 * weaken the #165 SSRF model; we pass them through unmodified.
 */
async function loadBrowserRuntime(loadEngine: () => Promise<PwModule | null>): Promise<BrowserRuntime | null> {
  const engine = await loadEngine();
  if (!engine) return null;
  // HERMETIC TEST SEAM: a non-default (injected) loader means a fake engine — take
  // the benign launch path WITHOUT consulting isServerlessRuntime() / importing
  // @sparticuz, so the unit tests behave identically whether or not the CI env
  // happens to set VERCEL / AWS_LAMBDA_FUNCTION_NAME / AWS_EXECUTION_ENV. Only the
  // real/default loader path reaches the serverless @sparticuz branch below.
  const isDefaultLoader = loadEngine === loadBrowserEngine;
  if (isDefaultLoader && isServerlessRuntime()) {
    try {
      // @sparticuz/chromium is an ESM-default module: the namespace's `.default`
      // holds { args, executablePath(), … }. Assemble the specifier at runtime.
      const spec = ['@sparticuz', '/chromium'].join('');
      const ns = (await import(/* webpackIgnore: true */ spec)) as unknown as {
        default?: { args: string[]; executablePath: () => Promise<string> };
        args?: string[];
        executablePath?: () => Promise<string>;
      };
      const sparticuz = ns.default ?? (ns as { args: string[]; executablePath: () => Promise<string> });
      // headless:true is set explicitly (newer @sparticuz dropped the `headless`
      // getter); args pass through unmodified per the egress audit above.
      const launchOptions: Record<string, unknown> = {
        args: sparticuz.args,
        executablePath: await sparticuz.executablePath(),
        headless: true,
      };
      return { chromium: engine.chromium, launchOptions };
    } catch {
      // @sparticuz failed to load/inflate on serverless → unavailable (clean
      // "browser unavailable" rather than a broken launch).
      return null;
    }
  }
  // Local/dev/CI: full playwright's bundled chromium, headless (today's path).
  return { chromium: engine.chromium, launchOptions: { headless: true } };
}

function capPage(text: string): string {
  return text.length > PAGE_MAX_CHARS ? `${text.slice(0, PAGE_MAX_CHARS)}…[truncated]` : text;
}

/**
 * A Playwright-backed BrowserDriver. Constructed lazily (the browser+context+page
 * are launched on first use). READ verbs return quarantined page text. WRITE
 * verbs (click/type) are described but NOT performed (the harness pauses for
 * approval); `commit` performs the already-approved verb.
 *
 * SSRF defense (per-request fetch-and-fulfill is the load-bearing guard):
 *  - On context creation we block uninterceptable egress classes
 *    (`serviceWorkers: 'block'` + `routeWebSocket('**', ws => ws.close())`) and
 *    install `context.route('**', …)`: EVERY http(s) request (main nav,
 *    redirects, subresources) is fetched through the pinned safeFetch and the
 *    bytes replayed via route.fulfill (headers sanitized) — Chromium never opens
 *    its own socket; any denial fails closed to route.abort().
 *  - `navigate` additionally runs a cheap safeFetch PRE-check that fails CLOSED
 *    (gated on the EgressDeniedError.reason enum: a private-ip/allowlist/dns/
 *    userinfo/protocol/port denial is a hard refusal; only a size/timeout cut —
 *    which still PROVES a public host was reached — is allowed to fall through).
 *  - READ verbs re-assert `assertSafeNavigateUrl(page.url())` before returning,
 *    so a page that moved to an internal URL since navigate yields a clean
 *    blocked observation instead of content.
 */
export class PlaywrightBrowserDriver implements BrowserDriver {
  private runtime: BrowserRuntime | null = null;
  private browser: PwBrowser | null = null;
  private context: PwContext | null = null;
  private page: PwPage | null = null;

  /**
   * @param isPublicIp the egress predicate (apps/web passes the connectors one).
   * @param loadModule TEST-ONLY seam — injects a fake PwModule (the chromium
   *   ENGINE) so the lifecycle/interception LOGIC is exercisable without a real
   *   Chromium. Production omits it and the runtime-aware `loadBrowserEngine` is
   *   used (full `playwright` locally; `playwright-core` + `@sparticuz/chromium`
   *   on Vercel/Lambda — see loadBrowserRuntime). With an injected loader the
   *   launch options stay the benign `{ headless: true }` (no @sparticuz import).
   * @param fetchImpl TEST-ONLY seam — the pinned fetch the interceptor calls.
   *   Defaults to the connector `safeFetch`; tests inject a fake to assert the
   *   fetch-and-fulfill / fail-closed behavior without real network egress.
   */
  constructor(
    private readonly isPublicIp: (addr: string) => boolean = browserIsPublicIp,
    private readonly loadModule: () => Promise<PwModule | null> = loadBrowserEngine,
    private readonly fetchImpl: SafeFetchFn = safeFetch,
  ) {}

  private async ensurePage(): Promise<PwPage> {
    if (this.page) return this.page;
    // Runtime-aware, lazy: returns the chromium engine + launch options for the
    // detected runtime (serverless → playwright-core + @sparticuz binary; local →
    // full playwright). The chromium layer is imported only here, only when a run
    // actually reaches a computer_use verb. The interception below is identical
    // regardless of which engine/binary launched (#165 egress model unchanged).
    this.runtime ??= await loadBrowserRuntime(this.loadModule);
    if (!this.runtime) throw new Error('playwright is not installed');
    this.browser ??= await this.runtime.chromium.launch(this.runtime.launchOptions);
    // `serviceWorkers: 'block'` closes a whole egress class: a Service Worker's
    // fetches originate OUTSIDE the page and CANNOT be intercepted by
    // `context.route('**')`, so without this a SW could open unpinned Chromium
    // sockets (the exact rebind class this PR exists to close).
    this.context = await this.browser.newContext({ serviceWorkers: 'block' });
    // WebSocket handshakes ALSO bypass `context.route('**')` (it only sees HTTP
    // requests), so they would otherwise open unpinned sockets. Close every WS
    // route immediately (we never proxy WS upstream — a bounded read/draft tool
    // has no WS need). routeWebSocket exists in Playwright >= 1.48 (branch pins
    // 1.61); guard so the fake-Pw harness / older builds don't throw — a missing
    // API must not crash the driver.
    if (typeof this.context.routeWebSocket === 'function') {
      await this.context.routeWebSocket('**', (ws) => {
        try {
          ws.close();
        } catch {
          // best-effort: a close on an already-closed route must not escape.
        }
      });
    }
    // LOAD-BEARING: serve Chromium's egress from a connection WE pin. Rather than
    // `route.continue()` (which lets Chromium open its own unpinned socket and
    // re-resolve DNS — the P2 rebind window), we fetch every http(s) request
    // through the connector `safeFetch` (DNS-validated + TCP-pinned + per-hop
    // re-checked) and `route.fulfill()` Chromium with those bytes. Chromium never
    // opens a socket to a host at all, so the rebind window is STRUCTURALLY closed
    // — for the main navigation, every redirect hop, AND every subresource.
    await this.context.route('**', async (route) => {
      // Best-effort abort: a reject (e.g. the route was already handled/closed)
      // must not escape this async handler as an unhandled rejection.
      const safeAbort = async () => {
        try {
          await route.abort();
        } catch {
          // best-effort, mirror close().
        }
      };
      const request = route.request();
      const url = request.url();
      // Classify the scheme. Only data:/blob:/about: carry no network egress and
      // no SSRF vector — let Chromium handle those directly. Anything else that
      // is NOT http(s) (file:/ftp:/ws:/unknown) is aborted, never continued.
      let scheme: string;
      try {
        scheme = new URL(url).protocol;
      } catch {
        await safeAbort();
        return;
      }
      if (scheme === 'data:' || scheme === 'blob:' || scheme === 'about:') {
        await route.continue();
        return;
      }
      if (scheme !== 'http:' && scheme !== 'https:') {
        // file:/ftp:/unknown → abort (don't hand Chromium a non-egress-safe URL).
        await safeAbort();
        return;
      }
      // http(s): fetch through the pinned safeFetch and fulfill from those bytes.
      try {
        const policy: EgressPolicy = {
          maxResponseBytes: EGRESS_MAX_BYTES,
          timeoutMs: NAV_TIMEOUT_MS,
          maxRedirects: 3,
        };
        const init: SafeFetchInit = {
          method: request.method(),
          headers: stripRequestHeaders(request.headers()),
          body: request.postData() ?? undefined,
        };
        const resp = await this.fetchImpl(
          url,
          init,
          policy,
          // generic-rail (no allowedHosts) — any public host, private answers
          // rejected, connect pinned. Mirror navigate's probe: allow http only
          // when the request URL is http:.
          { ...(scheme === 'http:' ? { allowHttp: true } : {}) },
        );
        // Sanitize the verbatim origin headers before replaying: drop the
        // framing/hop-by-hop/set-cookie headers (Playwright recomputes framing
        // from the Buffer) but KEEP content-encoding (the body is still encoded).
        // See sanitizeResponseHeaders / STRIPPED_RESPONSE_HEADERS.
        await route.fulfill({
          status: resp.status,
          headers: sanitizeResponseHeaders(resp.headers),
          body: resp.body,
        });
      } catch {
        // FAIL CLOSED. Every EgressDeniedError reason (private-ip/dns/allowlist/
        // protocol/redirect/port/credentials), AND a size/timeout cut (we could
        // not retrieve the full body over the pinned connection), AND any other
        // throw → abort. We NEVER route.continue() an http(s) request.
        await safeAbort();
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
  // Probe the runtime-aware engine loader (full playwright locally; playwright-core
  // on serverless) — if nothing loads, the surface is unavailable. The actual
  // chromium launch (and the @sparticuz layer on serverless) stays lazy in
  // ensurePage(); this probe does NOT import @sparticuz.
  const engine = await loadBrowserEngine();
  if (!engine) return undefined;
  return new PlaywrightBrowserDriver();
}
