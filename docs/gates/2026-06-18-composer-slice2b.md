# Adversarial Gate Report — Composer Slice 2b (detect-and-nudge family)

**Date:** 2026-06-18
**Branch:** `feat/composer-slice2b`
**Surface:** sensitive (`packages/runtime` + composer/adopt path + connectors). Populates the Slice-2a synthesis mechanism with 3 more primitives — no new safety mechanism, **no migration** (`adopt_nibbin` v2 already live on dev/staging/prod).
**Spec:** `docs/superpowers/specs/2026-06-18-composer-slice2b-design.md` · **Plan:** `docs/superpowers/plans/2026-06-18-composer-slice2b.md`
**Reviewers (4 lenses):** red-team · logic-skeptic · claims-auditor · cost-auditor
**Verdict: PASS** — no P0/P1 surviving. Parity was independently hand-verified by two reviewers; the one P1 (a parity-*test* overclaim — the parity was real but unguarded in CI) + the P2 coverage gap + two P3 belts were all fixed in-branch.

## What 2b adds
Three detect-and-nudge primitives, each parity-extracted from an existing reviewed template (template program now delegates to the shared impl):
- `nudge.overdue-invoice` (from `tally`) — stripe `payments.read` → `invoice.nudge`, param `minDaysLate` (default 0 = tally).
- `nudge.unconfirmed-event` (from `hopper`, **cross-resource**) — `calendar.read` on the gcal connection → `email.draft` on the gmail connection, param `withinDays` (default 7).
- `reply.new-inquiry` (from `scribe`) — `email.read` → `email.draft`, empty inputSchema.

Plus the one generalization the cross-resource case forces: the Composer derives a spec's `requiredConnectors`/`toolsAllowlist` from the primitive's `effectiveTools` (union of connectors), server-side from the registry — never from LLM output. The menu hides any primitive whose connectors aren't ALL granted.

## Security thesis (re-verified)
Unchanged from 2a and confirmed by all four reviewers: the LLM picks only a **primitive id + scalar params validated against `inputSchema`** (bounded at both adopt-time and run-time). Trusted primitive code builds all read paths + effectArgs. The cross-resource connectionId routing is hardcoded from trusted provider keys (`connMap['google-calendar']` for the read, `connMap.gmail` for the draft — not swappable). `validateComposedSpec` independently re-checks `requiredConnectors ⊆ accountConnections` (so a tampered menu/spec can't adopt) and the 2a "reject raw non-primitive draft/write composed step" rule still holds. Each primitive's polite-pause throws **inside** its generator (the 2a P1 lesson), incl. checking both connectors for the cross-resource one.

## Findings & dispositions
| # | Lens | Sev | Finding | Fix |
|---|------|-----|---------|-----|
| 1 | claims-auditor | P1 | **Parity-test overclaim.** The parity tests pinned hardcoded values and never drove the actual template programs — so parity was real (hand-verified) but a future delegation drift in `programs.ts` would NOT fail any test. (logic-skeptic flagged the same as P3; same gap existed in 2a.) | Added `apps/web/lib/runtime/programs.parity.test.ts`: for each of {echo, tally, hopper, scribe} it drives the real template `ProgramFn` (via `buildProgram` routing) AND the primitive over the same fixture and asserts the full yielded-step arrays are deep-equal (+ an anti-vacuous "a draft was yielded" guard). Verified it bites (breaking tally's delegation fails it). |
| 2 | claims-auditor | P2 | **New parameterization behaviorally untested.** `minDaysLate`/`withinDays` were only tested at defaults + a validator-bound case; the grace-window/horizon behavior (the one thing 2b adds beyond the templates) was unpinned. | Added tests: `minDaysLate=30` excludes a 10-day-late invoice, drafts a 40-day-late one; `withinDays=30` widens the yielded `calendar.read` `timeMax` to `now+30d`. |
| 3 | red-team | P3 | **No `sanitizeEffectArgs` backstop on primitive-yielded draft steps** (only raw atomic composed steps got it). Inert today (each primitive sanitizes its own `to` via `safeAddress`), but a future primitive's CRLF safety would rest solely on it remembering. | Interpreter now runs primitive-yielded `draft`/`write` `effectArgs` through `sanitizeEffectArgs` (idempotent — a true no-op on every existing fixture, confirming current primitives already sanitize). |
| 4 | red-team | P3 | Per-step `granted.has(cap.requiredConnector)` checks only the "home" connector for a cross-resource primitive; completeness lives in the separate `requiredConnectors` loop. | Added a comment so the `requiredConnectors`/`validateSpec` loop isn't later removed thinking the per-step check covers it. |
| — | claims-auditor | P3 | Review summary landed in `compose.ts summarize()` + `actions.ts connectorLabel` rather than `BuildNibbinButton.tsx` as the plan said. | No defect — summaries render for all 4 primitives; recorded for honesty. |

### Verified clean (not findings)
- **Cost-auditor: PASS, no findings** — every primitive drafts exactly ONE item (worst invoice / next unconfirmed event / newest inquiry); reads are fixed-count under the 120-step ceiling (invoice 1 read, event 1 read, inquiry ~82-read sweep); `withinDays`/`minDaysLate` are schema-bounded and don't change `maxResults`/`limit`; NO new entry point or model call (`actions.ts` change is display-only); composed specs inherit the same daily+cooldown trigger and ceilings as 2a.
- **Red-team: could not break it** — multi-connector derivation is purely server-side; cross-resource routing not swappable; params schema-bounded; `effectiveTools` match each impl's yields; empty inputSchema rejects extra keys (`Object.hasOwn`).
- **Logic-skeptic: parity holds** — hand-diffed all three primitives + `shared.ts` against `origin/main` byte-for-byte; confirmed `reply.new-inquiry` correctly inlines scribe's newest-first/no-staleness filter (not the overdue oldest-first helper); echo/sweep/brief unchanged.

## Verification (post-fix)
- `npx tsc --noEmit -p packages/runtime` → exit 0
- `npx tsc --noEmit -p apps/web` → exit 0
- `npx vitest run packages/runtime/test apps/web/` → **415 passed (55 files)** (incl. the new differential parity test)
- `npx eslint packages/runtime/src apps/web/lib/composer apps/web/lib/runtime apps/web/app/app/diagnosis` → clean
- `npm run build -w @nibbin/web` → Compiled successfully; static pages 20/20

## Migration
None. `adopt_nibbin` v2 (Slice 2a, `20260618050000`) already live on dev/staging/prod; 2b adds no schema.

## Deferred (per spec)
The digest/summarize shape (`sweep`, `brief`) = Slice 2c; multi-primitive composition; editing the proposed spec; Planner (Slice 3); Crystallization (Slice 4).
