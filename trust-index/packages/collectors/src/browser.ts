/**
 * Launching Chromium in this sandbox, correctly.
 *
 * Every agent that reached for Playwright got ERR_CONNECTION_RESET and wrote
 * the web-signup route off as impossible. It was not: the browser works, under
 * two conditions that are not discoverable from the error.
 *
 *   DIRECT EGRESS. The session exports HTTPS_PROXY and Chromium inherits it;
 *   every navigation through that proxy resets. Our own guardedFetch has worked
 *   all along because pinnedFetch dials the vetted address directly, and the
 *   browser needs the same route. `--no-proxy-server` alone is NOT enough — the
 *   proxy environment variables have to be cleared from the process too, which
 *   is why `launchBrowser` scrubs them rather than trusting the flag.
 *
 *   NO QUIC. Without `--disable-quic`, hosts that negotiate HTTP/3 fail with
 *   ERR_QUIC_PROTOCOL_ERROR while plainer hosts succeed. That reads as "this
 *   particular server is down" and invites exactly the wrong conclusion again.
 *
 * Verified: example.com 200, klarix.ai/mcp 200, accounts.google.com 200.
 *
 * THIS EGRESS IS FLAKY, AND THAT MATTERS MORE THAN THE FLAGS. Chasing a run
 * where every host failed, I blamed --dns-over-https-mode=off, then blamed this
 * file's own --disable-features for overriding Playwright's. Both explanations
 * were wrong: re-tested side by side, the identical configs all returned 200.
 * The failures were transient. Two confident diagnoses of a flaky network is
 * the same error this project keeps making — reading "I could not obtain it"
 * as "it is not there" — so navigation retries rather than concluding, and a
 * host is only reported unreachable after `gotoWithRetry` has actually tried.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT FOR. Driving a signup form a person
 * would otherwise fill in by hand. It is not for defeating bot detection: a
 * Turnstile widget, a hCaptcha, or a honeypot field is a refusal, and the
 * answer is to record it and stop. That is a rule about what we are willing to
 * be, not a limit on what the tooling could do.
 */
import type { Browser, BrowserContext } from "playwright";

/** Proxy variables Chromium picks up implicitly. All must be cleared. */
const PROXY_VARS = ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "ALL_PROXY", "all_proxy"] as const;

export const CHROMIUM_PATH = "/opt/pw-browsers/chromium";

export const LAUNCH_ARGS = [
  "--no-sandbox",
  // Both are load-bearing; see the header.
  "--no-proxy-server",
  "--disable-quic",
  // Encrypted Client Hello, which can surface as
  // ERR_ECH_FALLBACK_CERTIFICATE_INVALID and reads like a bad certificate on a
  // host that is fine. Harmless to disable; see the note below on how much
  // credit it actually deserves.
  "--disable-features=EncryptedClientHello",
] as const;

export type LaunchedBrowser = { browser: Browser; context: BrowserContext; close: () => Promise<void> };

/**
 * A browser that can actually reach the internet from here.
 *
 * Clears the proxy vars for this process before launching. That is a global
 * mutation and it is deliberate: Chromium reads them at spawn, and a helper
 * that only sets a flag leaves the next caller with the same reset nobody could
 * explain. Anything in-process that needs the proxy should use guardedFetch,
 * which does not read these variables.
 */
export async function launchBrowser(
  opts: { headless?: boolean; userAgent?: string; storageStatePath?: string } = {},
): Promise<LaunchedBrowser> {
  for (const v of PROXY_VARS) delete process.env[v];

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: opts.headless ?? true,
    args: [...LAUNCH_ARGS],
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    ...(opts.userAgent === undefined ? {} : { userAgent: opts.userAgent }),
    ...(opts.storageStatePath === undefined ? {} : { storageState: opts.storageStatePath }),
  });
  return {
    browser,
    context,
    close: async () => {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
}

/**
 * Bot-detection markers we refuse to engineer around.
 *
 * Returned as a named list rather than a boolean so a report can say WHICH
 * control stopped it — "Cloudflare Turnstile" is actionable for the owner in a
 * way that "blocked" is not.
 */
export const BOT_DETECTION_MARKERS: ReadonlyArray<{ name: string; selector: string }> = [
  { name: "Cloudflare Turnstile", selector: '[data-sitekey], .cf-turnstile, iframe[src*="challenges.cloudflare.com"]' },
  { name: "reCAPTCHA", selector: '.g-recaptcha, iframe[src*="recaptcha"]' },
  { name: "hCaptcha", selector: '.h-captcha, iframe[src*="hcaptcha"]' },
  // A hidden text input the form expects to stay empty. Filling it marks you a
  // bot; leaving it empty is the honest behaviour, so this is a marker that the
  // operator is screening for automation, not something to defeat.
  { name: "honeypot field", selector: 'input[type="text"][aria-hidden="true"], input[name="website"][class*="hidden"]' },
];

/**
 * Navigate, retrying the transport errors this sandbox produces on its own.
 *
 * ERR_CONNECTION_RESET, ERR_ECH_FALLBACK_CERTIFICATE_INVALID and
 * ERR_QUIC_PROTOCOL_ERROR all showed up here against hosts that were serving
 * perfectly a minute later. One attempt is not evidence a site is down; it is
 * evidence of one attempt.
 */
const TRANSIENT = /ERR_CONNECTION_RESET|ERR_ECH_FALLBACK_CERTIFICATE_INVALID|ERR_QUIC_PROTOCOL_ERROR|ERR_NETWORK_CHANGED|ERR_TIMED_OUT|ERR_SOCKET_NOT_CONNECTED/;

export async function gotoWithRetry(
  page: { goto: (url: string, o?: unknown) => Promise<{ status: () => number } | null> },
  url: string,
  opts: { attempts?: number; timeoutMs?: number } = {},
): Promise<{ ok: true; status: number } | { ok: false; error: string; attempts: number }> {
  const attempts = opts.attempts ?? 3;
  let last = "";
  for (let i = 0; i < attempts; i += 1) {
    try {
      const r = await page.goto(url, { timeout: opts.timeoutMs ?? 25_000, waitUntil: "domcontentloaded" });
      return { ok: true, status: r?.status() ?? 0 };
    } catch (e) {
      last = String(e).match(/net::[A-Z_]+/)?.[0] ?? String(e).slice(0, 120);
      if (!TRANSIENT.test(last)) return { ok: false, error: last, attempts: i + 1 };
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
  return { ok: false, error: last, attempts };
}

/** Which bot-detection controls, if any, this page is using. */
export async function detectBotControls(page: {
  $$: (selector: string) => Promise<unknown[]>;
}): Promise<string[]> {
  const found: string[] = [];
  for (const m of BOT_DETECTION_MARKERS) {
    try {
      if ((await page.$$(m.selector)).length > 0) found.push(m.name);
    } catch {
      /* a selector that will not parse in this engine is not a finding */
    }
  }
  return found;
}
