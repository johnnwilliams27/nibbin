# Adversarial Gate Report — Planner Slice 3a follow-ups (DNS-rebind SSRF + resume repetition)

**Date:** 2026-06-19
**Branch:** `fix/planner-followups`
**Surface:** the two tracked low-risk follow-ups from the Planner Slice 3a gate (`docs/gates/2026-06-18-planner-slice3a.md`). Touches `packages/runtime` (sensitive-path) + the Planner web-egress; security-relevant (SSRF). No migration.
**Reviewers:** red-team (the SSRF/rebind lane) + logic-skeptic (correctness of both fixes). Right-sized to two reviewers for a 266-line hardening PR — one fix reuses a pre-audited helper, the other is a localized correctness fix; cost (no cost-surface change) and claims (covered by the two substantive lenses) were not separately run.
**Verdict: PASS** — no P0/P1/P2 from either reviewer. One shared P3 (a fail-closed behavior narrowing) recorded as **accepted**.

## The two fixes
1. **DNS-rebinding SSRF on `web.fetch`** (`apps/web/lib/planner/websearch.ts`) — the old guard was literal-IP/string only; a public hostname resolving to a private IP wasn't blocked. **Fix: delegate the outbound call to `@nibbin/connectors`' audited `safeFetch` egress proxy** (the same one the connector base/OAuth/rails use), keeping the literal pre-filter + credentials/non-http(s) checks + quarantine/length-cap + the clean no-throw failure path.
2. **Resume repetition rebuild** (`packages/runtime/src/planner.ts`) — the rebuild counted only atomic reads, so a resumed loop could repeat a primitive past `REPETITION_KILL_AT`. **Fix: `rebuildReadRepetition` replays each resumed connector turn through the SAME program the live loop runs** (`interpretSpec ∘ stepSpecFor`) and increments the repetition map for every yielded `read`, keyed identically to live `dispatchStep`.

## Findings
**No P0/P1/P2.** Verified clean:
- **Red-team (SSRF):** the rebind TOCTOU is genuinely closed — `safeFetch` resolves once, validates every resolved answer (one private answer poisons the set), and **pins the TCP connect to the validated IP literal** so Node can't re-resolve; redirects are re-validated per hop (strictly stronger than the old `redirect:'error'`); IPv6 (`::1`/ULA/link-local/v4-mapped)/metadata `169.254.169.254`/octal-hex-decimal obfuscation all correctly classified (verified by executing `isPublicIp` against 18 vectors). All planner guards preserved (quarantine, length cap, `web.search` allowlist, no-throw clean observation). The test-seam second arg is structurally unreachable from production (the prod path calls `webFetch(url)` one-arg).
- **Logic-skeptic (correctness):** FIX 2's rebuild key matches the live key **byte-for-byte** (same `step` object from the same program, same `hashArgs` export) → the kill fires; replay is faithful (the feed-independent mailbox list-read is the repetition driver and is always yielded; skipped per-record meta reads are unique-per-id and never the driver); utility/`ask_human`/`done`/sentinel turns are skipped cleanly; a throwing turn doesn't abort the resume; **no live-behavior change and no double-count** (cold path no-ops the rebuild; the live loop only dispatches new picks). FIX 1 preserves quarantine/cap/timeout and the clean no-throw failure path; one-arg production call works.

### P3 (accepted, not a finding to fix) — both reviewers
`safeFetch` rejects URLs with a **non-default explicit port** (`allowAnyPort` is test-only), so a public page on a non-standard port (e.g. `:8443`) that the old global-`fetch` path would have fetched now returns a quarantined "not reachable." This is a fail-closed, safe-direction capability narrowing — **accepted** as desirable SSRF posture for the Planner's open-web egress; not changed.

## Verification (post-build)
- `npx tsc --noEmit -p packages/runtime` → exit 0; `apps/web` → no planner/websearch errors (the 11 `@nibbin/channels` tsc errors are a pre-existing local symlink artifact, identical on base `ca5c85c`; `next build` passes — the authority).
- `npx vitest run packages/runtime/test apps/web/lib/planner` → **214 passed** (incl. the new rebind + resume-kill + cold-run-twin tests)
- `npx eslint packages/runtime/src apps/web/lib/planner` → clean
- `npm run build -w @nibbin/web` → Compiled successfully; static pages 24/24

## Migration
None.

## Arc state
Closes the two tracked Planner follow-ups. Remaining synthesis-adjacent pieces (each its own scoped design): browser/`computer_use` layer (the next big one); Routing Reinforcement Slice B (parked until a 2nd eval-cleared model + signal data exist); Training Mode.
