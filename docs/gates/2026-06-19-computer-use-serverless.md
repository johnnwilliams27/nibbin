# Adversarial Gate Report — computer_use serverless-Chromium runtime

**Date:** 2026-06-19
**Branch:** `feat/computer-use-serverless` (rebased onto main incl. #165 browser-egress-pin / #166 / #167 / #168)
**Surface:** makes the `computer_use` Planner capability RUNNABLE in Vercel (`@sparticuz/chromium` + `playwright-core`, lazy serverless launch) so `COMPUTER_USE_ENABLED` can be flipped in prod. Runtime-only — the #165 SSRF/egress guards are untouched. No migration. Feature still OFF by default.
**Reviewers:** red-team (egress integrity under the serverless launch) · logic-skeptic (correctness / build / deploy-viability). Right-sized to two lenses (no DB, no new external surface; egress is the load-bearing concern).
**Verdict: PASS** — no P0/P1 (egress model intact). One P1-deploy-viability + P3s fixed in-branch (`1cd95e3d`). Two items are gated to the flag-flip op (below).

## What it is
`ensurePage()` now launches a runtime-appropriate Chromium **lazily**: serverless (`process.env.VERCEL`/`AWS_LAMBDA_FUNCTION_NAME`/`AWS_EXECUTION_ENV`) → `playwright-core` + `@sparticuz/chromium` (`executablePath()`+`args`); local/CI → full `playwright`'s bundled Chromium (today's path). The #165 guards run **unconditionally after launch**, independent of which binary launched: `serviceWorkers:'block'` → `routeWebSocket('**', close)` → `route('**')` fetch-and-fulfill via pinned `safeFetch` (header-sanitized, fail-closed `route.abort()`) → only then `newPage()`. Deps ship to prod (`dependencies`); full `playwright` stays a devDep for local + the CI live test. `next.config.mjs` `outputFileTracingIncludes` ships the `@sparticuz` binary on exactly the 4 routes that can launch a Planner run; a dedicated CI `computer-use-live` job runs the real-Chromium interception suite on Linux (closing #165's P3).

## Findings
**Red-team — egress INTACT, no P0/P1.** Verified the actual `@sparticuz` v149 `args` contain **no** `--proxy-*`, `--remote-debugging-*`, or NetworkService-disabling flag (the `--disable-web-security`/site-isolation relaxations are renderer-side and cannot bypass the `route('**')` interception — the network decision lives in pinned `safeFetch`). Guards wired before any page/request; dynamic-import fail-safe (absent `@sparticuz` → driver unavailable, never an unguarded browser); `executablePath()` called with no arg → bundled binary, no attacker-controlled path. Channel-webhook `maxDuration` bumps add no abuse surface (computer_use stays double-gated by the flag + School/approval regardless of entry route).

**Logic-skeptic — PASS conditional on the timing fix.** Route selection is precisely targeted (only planner + the 3 channel webhooks that can launch a Planner run via `runPlan`; the autonomous cron/Gmail-push paths build no driver and are correctly excluded). Lazy load, dep hygiene (no default-install browser download), flag-off inertness all confirmed.

### Fixed in-branch (`1cd95e3d`)
| Sev | Issue | Fix |
|-----|-------|-----|
| **P1 (deploy-viability)** | `maxDuration=120` exceeds the Vercel **Hobby 60s** cap (every existing route caps at 60), and the 90s computer_use loop ceiling can't fit a 60s function. | **Deploy-everywhere default:** `maxDuration=60` on the bumped routes + `COMPUTER_USE_CEILINGS.maxWallClockMs` `90_000→50_000` (a safety cap; supervised runs finish in seconds; 50s leaves headroom for one in-flight action + teardown so the loop kill fires before the platform kill). Pro+ can raise both — documented. |
| P3 (logic-skeptic) | the test seam wasn't hermetic — a test env setting `VERCEL`/`AWS_*` would make fake-Pw unit tests attempt the real `@sparticuz` import. | the serverless launch path is now gated on the **default loader** (`loadEngine === loadBrowserEngine`); an injected test loader always uses benign `{headless:true}` regardless of env. Test added (sets `VERCEL=1` + fake loader → uses the fake). |
| P3 (red-team) | `@sparticuz ^149` could silently gain a proxy/debug arg on a future bump → weaken pinning. | new `sparticuz-args.test.ts` asserts `chromium.args` has no `--proxy-*`/`--remote-debugging-*`/NetworkService-disabling token (a bad bump fails CI); dep tightened to `~149.0.0` (patch-only). |

## ⚠️ Gated to the flag-flip op (NOT merge blockers — feature ships OFF)
1. **Confirm the prod Vercel plan / run the deploy smoke test.** The serverless flag combination (`@sparticuz` args) is NOT exercised by the CI live job (CI runs full `playwright`'s Chromium, not the serverless binary). nft bundle inclusion of the `.br` binary, the 250 MB unzipped limit, and a real Vercel Chromium launch are only provable by a deploy. **Before/at flag-flip:** deploy + run one `navigate`+`extract` against a public page (expect a quarantined observation) AND one private/loopback target (expect blocked). If the prod project is Hobby, the 60s/50s config fits; on Pro+ the limits may be raised.

## Verification (post-rebase + fixes)
- `tsc -p packages/runtime` + `-p apps/web` → 0
- `vitest run packages/runtime/test apps/web/lib/planner` → **305 passed | 3 skipped** (live suite self-skips; sparticuz-args + hermetic-seam tests pass)
- `eslint …` clean · `npm run build -w @nibbin/web` → Compiled successfully · default `npm install` triggers no browser download

## Migration
None.
