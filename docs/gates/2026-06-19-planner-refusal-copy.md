# Gate Note — Planner refusal copy for non-public URLs

**Date:** 2026-06-19
**Branch:** `fix/planner-refusal-copy` (off main)
**Surface:** `apps/web/lib/planner/plan.ts` (+ test). A P3 UX fix found during the prod computer_use smoke test. Additive refusal only — no egress/runtime logic change. No migration.
**Review:** self-review (tiny, additive, strictly-safer change) + CI (the adversarial-gate covers the planner surface). **Verdict: PASS.**

## What it fixes
When a user asked the Planner to open an internal/non-public URL (`http://169.254.169.254/`, `localhost`, a private IP), the egress guards correctly prevented any access — but the refusal MESSAGE was model-confabulated ("No URL was provided… I do not have a web browsing tool available"), which is false (it browses public pages fine), and the doomed request still consumed a per-user daily frontier-budget unit.

## The fix
A deterministic `firstNonPublicUrl(intent)` pre-check in `planForIntent`, placed after the `!llm` guard and BEFORE `router.route()`/`llm()`. If the request references a URL whose host is non-public, it returns a clear refusal:
> "I can only browse public web pages — I can't access internal or non-public addresses (like cloud-metadata, localhost, or private IPs)."

Host classification mirrors `assertSafeNavigateUrl` (`packages/runtime/src/browser.ts`) exactly — localhost/`.local`/`.internal` suffixes + `isLiteral && !isPublicIp`, reusing the imported `isPublicIp` from `@nibbin/connectors` (no IP logic re-implementation). Conservative parse (invalid tokens skipped, never throws). Bonus: short-circuiting before the model means an internal-URL request no longer spends a frontier-budget unit on a run that would only be refused.

## Safety
Strictly-safer (it ADDS a refusal path; never loosens). No egress/interception/runner change. The deterministic guard is defense-in-depth ON TOP of the existing navigate-time `assertSafeNavigateUrl` + the in-Chromium fetch-and-fulfill interceptor (both unchanged) — those remain the load-bearing SSRF guards; this just makes the user-facing refusal honest + cheaper.

## Verification
- `tsc -p packages/runtime` + `-p apps/web` → 0
- `vitest run apps/web/lib/planner` → **64 passed | 3 skipped** (`plan.test.ts` = 9: 4 original + 5 new — metadata-IP / localhost / private-IP each assert the exact message AND that the model is NOT called; public URL + non-URL intent proceed normally)
- `eslint` clean · `npm run build -w @nibbin/web` → Compiled successfully

## Migration
None.
