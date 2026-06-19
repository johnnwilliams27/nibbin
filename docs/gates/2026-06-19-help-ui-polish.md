# Adversarial Gate — App UI polish (tooltips, connectors, logo proxy, nibbins header)

**PR:** `feature/help-ui-polish` (PR1 of the UI batch)
**Date:** 2026-06-19
**Sensitive surface:** `apps/web/app/api/connector-logo/route.ts` (logo proxy) → full 4-reviewer gate.

## Scope
Tooltip/InfoTooltip UI primitive + rollout (`components/ui/Tooltip.tsx`, `TrainingToggle.tsx`, `nibbins/page.tsx`, `HatchWizard.tsx`); connector directory polish (`ConnectorDirectory.tsx` + `help.module.css` — styled sort, card contrast, 2-line clamp); multi-source logo proxy (`api/connector-logo/route.ts` — Clearbit → Google favicons → DuckDuckGo); Your-Nibbins content header + responsive (`nibbins/page.tsx` + `nibbins.module.css`).

## Verdicts (initial → after fixes)
| Reviewer | Initial | After fixes |
|---|---|---|
| Red-team | PASS (0 P1/P2, 5 P3) | — |
| Claims-auditor | PASS-WITH-FIXES (2 P2) | PASS |
| Cost-auditor | PASS-WITH-FIXES (1 P2) | PASS |
| Logic-skeptic | PASS-WITH-FIXES (2 P1, 1 P2, 1 P3) | PASS |

## Findings resolved (fix commit `1c11507f`)
- **P1 (logic) — `<button>` inside `<p>` hydration breakage.** `InfoTooltip` (renders a `<button>`) sat inside `<p>` in `nibbins/page.tsx` (intro) and `HatchWizard.tsx` (step 3) → React hydration mismatch. **Fix:** those `<p>` → `<div>` (classNames kept). No `Tooltip`/`InfoTooltip` remains inside a `<p>`.
- **P2 (claims) — promotion tooltip false precision.** "95% of last 25 decisions" omitted the additive stakes-weighting + (senior→grad) ≥4-pattern coverage gates. **Fix:** reworded to an accurate general statement.
- **P2 (claims) — graduate demotion overstated.** "move it back to draft-only any time" was wrong (demoting a graduate → senior, not draft-only). **Fix:** "step it back a grade any time." Pre-grad draft-only tooltip left unchanged (correct).
- **P2 (cost) — logo proxy worst-case latency.** 3 sources × 4s = 12s risked Vercel's 10s function limit. **Fix:** `LOGO_FETCH_TIMEOUT_MS` 4000 → 2000 (6s worst case), sequential quality order preserved.
- **P2 (logic) — tooltip a11y.** `role="tooltip"` wasn't associated with its trigger. **Fix:** `Tooltip.tsx` → client component; `useId()` bubble id; `InfoTooltip` button + `Tooltip`'s cloned child get `aria-describedby` (merges existing). Additive tests.
- **P3 (red-team) — content-type reflected with params.** **Fix:** normalize via `.split(";")[0].trim().toLowerCase()` for the `image/*` gate + forwarded header.
- **P3 (logic) — redundant CSS** at the 640px breakpoint removed.

## Findings noted / not actioned
- Red-team P3: `image/svg+xml` passes the gate (acceptable — fixed-host CDNs rendered via `<img>`); 12s→6s total cap (now bounded); narrow `Tooltip.content` to `string` (kept `ReactNode` intentionally for rich tooltips).
- SSRF remains closed: allowlist (`ALLOWED_DOMAINS`) checked before any fetch; only the 3 fixed hosts with an allowlisted + `encodeURIComponent`-encoded domain; image-type + 512KB caps on all sources.

## Tests
20 files / 110 unit tests pass (incl. new tooltip a11y assertions). 0 tsc errors in changed files.

## Final verdict
**PASS** (after fixes). Re-review confirmed all P1/P2 resolved with no regressions.
