# computer_use serverless-Chromium runtime + enablement — design

**Date:** 2026-06-19
**Status:** approved (user: "build serverless-Chromium + enable"). Builds ON `feat/browser-egress-pin` (#165). No migration.
**Goal:** make the `computer_use` Planner capability actually RUN in Vercel's serverless runtime (today the driver returns `undefined` there because stock Playwright/Chromium can't launch), then flip `COMPUTER_USE_ENABLED` on in prod.

## Problem
`buildBrowserDriver()` loads Playwright via a dynamic import and launches `chromium.launch({ headless: true })`. Vercel's serverless functions have no system Chromium and can't run the full `playwright` browser download. So in prod the import/launch fails → driver unavailable → flipping the env flag does nothing. The egress hardening (#165) is correct and unchanged; this is purely the runtime.

## Approach — `@sparticuz/chromium` + `playwright-core`, lazy
The standard serverless pattern. Add as **runtime `dependencies`** of `@nibbin/web` (must ship to prod, not devDeps):
- `@sparticuz/chromium` — a Lambda/Vercel-compatible headless Chromium (brotli-compressed binary in node_modules; exposes `args`, `executablePath()`, `headless`).
- `playwright-core` — the Playwright engine WITHOUT bundled browsers (drives the `@sparticuz` binary). Keep the full `playwright` as a **devDependency** for local dev + the CI live test.

### Driver launch (the only behavioral change)
Make `ensurePage()`'s launch runtime-aware, lazily (the ~50 MB chromium layer must load ONLY when a run actually uses computer_use — keep the dynamic import inside `ensurePage`, not module top-level):
- **Serverless** (detect via `process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_EXECUTION_ENV`): load `playwright-core` + `@sparticuz/chromium`; launch with `{ args: chromium.args, executablePath: await chromium.executablePath(), headless: true }`.
- **Local/dev/CI** (no serverless env): prefer full `playwright` (bundled chromium) as today; fall back to `playwright-core` with a system channel if present.
- A single `loadBrowserRuntime()` returns `{ chromium: <pw.chromium>, launchOptions }` so `ensurePage` stays simple. Keep `loadModule` test seam working (the fake-Pw harness injects a module + the live test uses the real one).
- **SSRF invariants UNCHANGED:** the `@sparticuz` `args` must NOT include anything that breaks our model — verify they do NOT add a proxy, do NOT disable our `context.route`/`routeWebSocket`, and we still create the context with `serviceWorkers:'block'` + install the `route('**')` fetch-and-fulfill interceptor + `routeWebSocket` close. Same Chromium → route interception works identically. If any `@sparticuz` arg is incompatible with egress pinning, drop/override it and document why.

### Vercel function config
The planner-run code path (computer_use executes inside a Planner ReAct run → `triggerNibbinRun`/the planner route(s) under `apps/web/app/app/planner/…` and any route that can launch a planner run) needs headroom for Chromium:
- Set `export const maxDuration` (e.g. 60–300s within plan) and a memory hint where Vercel supports it, on the route(s) that can run computer_use. Identify them precisely (grep the planner run entry points); don't blanket-bump unrelated routes.
- Confirm the `@sparticuz/chromium` binary is included in the function bundle (it lives in node_modules; Vercel's nft tracing should include it because it's `require`d at runtime — verify, and add to `outputFileTracingIncludes`/`vercel.json` `functions` config if tracing misses it). Watch the 250 MB unzipped function limit (chromium ~50 MB compressed).

## The CI live test (make the #165 gated test actually run)
`browser.live.test.ts` exists but skips unless real Playwright + a launchable Chromium are present. Make it RUNNABLE on Linux CI:
- The full `playwright` devDep + `npx playwright install --with-deps chromium` in a dedicated CI job (NOT the default test job — keep the default job's install lean). The job sets `COMPUTER_USE_LIVE_TEST=1` and runs the live suite, asserting (a) the `route('**')` handler fires, (b) a private/loopback navigation is aborted (no content), (c) a public navigation is fulfilled from pinned bytes + quarantined. This is the real-Chromium proof of the egress fix that #165 could only inspection-verify.
- Add the CI job to `.github/workflows/…` as a separate (possibly `continue-on-error: false` but isolated) job so a Chromium hiccup doesn't block unrelated PRs but DOES gate this one.

## Enablement (after build + gate + merge + a green live job)
- Set `COMPUTER_USE_ENABLED=true` in Vercel **production** env.
- Because the runtime can only be fully proven by a real run, the FINAL step is a **prod deploy smoke test**: trigger one planner run that uses a `navigate`+`extract` against a known public page and confirm a quarantined observation (and that a private target is blocked). This is a human/ops step documented here; the code + flag are the deliverable.

## Verification (build-time)
- `tsc -p packages/runtime` + `-p apps/web` → 0
- `vitest run packages/runtime/test apps/web/lib/planner` → green (existing 301 + unchanged; live suite still SKIPS in the default job)
- `eslint …` clean · `npm run build -w @nibbin/web` → Compiled successfully
- Confirm the two new deps install cleanly and don't trigger a browser download in the DEFAULT install (only the live-test CI job downloads Chromium).

## Out of scope
Chromium for non-Vercel hosts; computer_use UX changes; the prod smoke test itself (documented, human-run).
