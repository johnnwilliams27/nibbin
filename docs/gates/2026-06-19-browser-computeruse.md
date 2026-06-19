# Adversarial Gate Report — Browser / `computer_use` Planner capability

**Date:** 2026-06-19
**Branch:** `feat/browser-computeruse`
**Surface:** HIGH-STAKES new capability — real browser control for the Planner (the deferred §4 computer-use layer). Touches `packages/runtime` core + a new open-web egress + an approval→commit action path. Migration `20260619100000_computer_use.sql` (no-DDL assertion guard). **Ships OFF by default** (`COMPUTER_USE_ENABLED`; Playwright not installed).
**Reviewers (4 lenses) + a focused P0-fix re-review.**
**Verdict: PASS to merge (feature off by default).** No surviving P0/P1. A P0 (navigate SSRF) was found, fixed, and the fix re-verified as closed. Two residuals are **gated to "before enabling `COMPUTER_USE_ENABLED` in production"** (below), not merge blockers.

## What it is
A `computer_use` tool family (`navigate/click/type/extract/scroll/screenshot` over a unified `target` = selector XOR coords) added to the Planner's bounded ReAct loop. LLM picks verb+target only (no eval/script); a `BrowserDriver` executes (Playwright adapter behind the flag; MockBrowserDriver for tests). Writes (`click`/`type`) are approval-gated + committed only on approval; reads quarantined; `computer_use` weight (10×) + tighter `COMPUTER_USE_CEILINGS` (20 iter / 40 steps / 12k tok / 90s).

## The P0 (found → fixed → re-verified)
**P0 (red-team, corroborated by claims-auditor) — `navigate` SSRF.** The original defense pinned a throwaway `safeFetch` probe while Chromium's actual `page.goto` re-resolved DNS unpinned, and `extract`/`screenshot`/`scroll` had no URL re-check → a redirect / JS-redirect / DNS-rebind from a public page reached internal hosts (e.g. metadata `169.254.169.254`), exfiltrated via the read verbs. (Latent — only reachable with the flag on — but a real SSRF.)
**Fix (`2c4aba8`):** three layered guards — (a) per-request `context.route('**')` interception that resolves every request (main nav + redirects + subresources) via `isRequestEgressAllowed` and `route.abort()`s any non-public answer ("one private answer poisons the set"); (b) `guardCurrentUrl` re-asserts `assertSafeNavigateUrl(page.url())` in all four read verbs before surfacing content; (c) the probe now fails closed on the `EgressDeniedError.reason` enum (only size/timeout, which prove a public host was reached, fall through) + the navigate call-site default is `() => false` (deny-all when `isPublicIp` absent). SSRF tests added at `web.fetch` parity (full literal/IPv6/octal/credentials/non-http battery via the real `isPublicIp`) + `isRequestEgressAllowed` unit-tested (public allow vs private/metadata/rebind/split-horizon abort).
**Re-review verdict:** the P0 is **CLOSED** by the three guards; no new P0/P1.

## Other findings (all fixed in-branch)
- **logic-skeptic: no P0/P1** — write-never-commits-inline, commit-at-most-once (CAS + idempotency.claim, can't be influenced by the resume payload), resume repetition key matches live byte-for-byte, ceilings enforced (can't widen), fail-closed target, no regression to the existing Planner.
- **cost-auditor: no P0/P1** — 10× weight forced structurally, ceilings enforced + server-re-stamped, off-by-default = zero cost + surface not offered, commit makes no model call.
- **claims-auditor: no P0/P1** — all safety claims TRUE + non-vacuously tested (closed verb set, idempotent approval-gated writes, quarantined reads incl. screenshot-as-text, off-by-default adapter genuinely unreachable, no-DDL migration). Clean diff hygiene (no NUL/binary/artifacts).
- **P3s fixed:** validator flag-aware (rejects `computer_use.*` when off); no-progress baseline now tracks the last *browser* observation (was comparing to the last utility obs → never tripped); driver `close()` + `finally` lifecycle (no orphaned Chromium) + lifecycle test; quarantine cap aligned (`PAGE_MAX_CHARS` 8000→3500 < `OBSERVATION_MAX_CHARS` so observations stay well-formed); re-validate target at commit; partial-coords + screenshot-text test cases.

## ⚠️ BEFORE ENABLING `COMPUTER_USE_ENABLED` IN PRODUCTION (tracked residuals — NOT merge blockers because the feature ships off)
1. **P2 — `route.continue()` is unpinned (narrowed rebind window).** The interceptor resolves + aborts non-public, but `route.continue()` lets Chromium re-resolve for the actual socket, leaving a sub-second-TTL DNS-rebind window the connector `safeFetch` closes via connection-pinning (which Playwright's route API can't replicate without a custom transport). Far narrower than the original P0 (which reached internal hosts unconditionally). **Must be addressed (pinned transport / fetch-based navigation) before the flag is enabled.**
2. **P3 — the live Playwright route wiring is unexercised by tests** (flag off + dep absent). The egress *logic* (`isRequestEgressAllowed`, `assertSafeNavigateUrl`, `guardCurrentUrl`, the fail-closed probe) is well-covered; the actual `context.route`→abort Chromium binding is inspection-verified only. **Needs an integration test against real Playwright before enabling.**

## Verification (post-fix)
- `tsc -p packages/runtime` + `-p apps/web` → 0
- `vitest run packages/runtime/test apps/web/lib/planner` → **252 passed** (+16 over the prior 236)
- `eslint packages/runtime/src apps/web/lib/planner` → clean
- `npm run build -w @nibbin/web` → Compiled successfully

## Migration
`20260619100000_computer_use.sql` — no-DDL assertion guard (`runs.weight_class` already admits `computer_use`, the 10× weight already exists). No table/column/view added.
