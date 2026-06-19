# Gate Report — computer_use serverless bundling fix

**Date:** 2026-06-19
**Branch:** `fix/computer-use-serverless-bundle` (off main)
**Surface:** fixes the confirmed prod bug where `computer_use` returns "the browser is unavailable for this run". Loader/bundling + diagnostics only — **no egress/interception logic change**. No migration. Feature still flag-gated (`COMPUTER_USE_ENABLED`, on in prod).
**Review:** diff-scope + egress-untouched self-review; the CI adversarial-gate runs on this sensitive surface; the DEFINITIVE proof is a prod deploy + smoke test (the new diagnostics confirm).
**Verdict: PASS to merge** — confined, egress-preserving fix of a deploy-only-provable bundling bug.

## The bug (found by the prod smoke test)
A live smoke test (planner task "open a public page") returned **"the browser is unavailable for this run."** Root cause: `loadBrowserEngine()` imported `playwright-core` via a runtime-assembled specifier `['playwright','-core'].join('')` (`/* webpackIgnore: true */`). Vercel's file tracer (`@vercel/nft`) cannot see a computed specifier → **`playwright-core` was never bundled into the serverless function** → `import('playwright-core')` throws → `loadBrowserEngine` returns null → driver unavailable (it never even reached the `@sparticuz/chromium` load, which WAS force-included). This is exactly the "only provable by a real deploy" residual the #169 gate flagged.

## The fix (2 files, no egress change)
1. **`apps/web/lib/planner/browser.ts`** — the two PROD-dep specifiers become STATIC LITERALS (keeping `webpackIgnore`): `'playwright-core'` and `'@sparticuz/chromium'`. A static literal + `webpackIgnore` keeps the package external to webpack (no bundle bloat / no native-build break) WHILE letting nft see the literal in the output and trace it (+ transitive deps) into the function. The full `playwright` (devDep, absent in prod) stays the computed `['play','wright'].join('')` so nft doesn't try to bundle a missing package.
2. **`apps/web/next.config.mjs`** — `'../../node_modules/playwright-core/**'` added to `outputFileTracingIncludes` alongside `@sparticuz/chromium/**` on all four computer_use-capable routes (planner + 3 channel webhooks) — belt-and-suspenders so playwright-core's files ship even if a transitive trace is missed.
3. **Diagnostics (failure-path only, no PII/secrets):** `buildBrowserDriver` warns on flag-off vs engine-load-null; `loadBrowserEngine`'s catch names the exact failing specifier + error. So the NEXT deploy's `vercel logs` confirm whether the engine now loads, and if not, exactly which import failed.

## Egress integrity
`git diff` confirms **no egress/interception line changed** — `context.route('**')` fetch-and-fulfill, `serviceWorkers:'block'`, `routeWebSocket`, `sanitizeResponseHeaders`, `safeFetch`, `assertSafeNavigateUrl`, the `isDefaultLoader` hermetic test seam, and the ceilings are all untouched. Only HOW the engine deps load + diagnostics changed. The #165/#169 SSRF model is intact.

## Verification
- `tsc -p packages/runtime` + `-p apps/web` → 0 · `vitest run packages/runtime/test apps/web/lib/planner` → **305 passed | 3 skipped** (live suite skips) · `eslint` clean · `npm run build -w @nibbin/web` → Compiled successfully (no module-not-found — `webpackIgnore` keeps the literals external as intended).

## ⚠️ Definitive proof = prod deploy + smoke test
The static-literal change only alters nft behavior in the **Vercel build pipeline**, which can't be exercised locally. After merge + redeploy: re-run the smoke test (public page → quarantined content; private/loopback → blocked). If it still fails, the new `console.warn` diagnostics in `vercel logs` name the exact cause.

## Migration
None.
