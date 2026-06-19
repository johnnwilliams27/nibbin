# Adversarial Gate — App UI/Feature Sweep (consolidated)

**PR:** consolidated UI/feature sweep (`feature/nav-polish`)
**Date:** 2026-06-19
**Sensitive surfaces:** `supabase/migrations/`, `packages/keeper/`, `apps/desktop/src-tauri/`, service-role writes → full 4-reviewer gate.

## Scope (one PR, many changes — per the consolidation decision)
Shell/nav polish (Planner nav + route glyph + active, "Help Center", sprout logomark when collapsed, tighter nav, edit-mode flicker portal-fix, in-chat keeper scale-down); nibbin **pause/resume/delete(=sleep)** (migration `20260619270000` + 3 member-checked RPCs + roster UI + `.neq('status','sleeping')` filter); **fluid responsiveness + motion** (clamp type/spacing tokens, ease tokens, auto-fit grids, entrance/hover motion, reduced-motion); **Planner thinking-UX** (Tier 1 optimistic step reveal + spinner); **onboarding moments → leaves** (emit at done, removed from chat; `packages/keeper`); **desktop fixes** D1–D8 (first-render loader, live status, quick-scan consent copy, tab chrome, tray dedup+cleanup, Windows immediate `observerd` spawn + `tauri-plugin-single-instance`); **freeform "build your own"** (text→workflow synthesis→composeSpec→adopt + starter fallback); **admin** (card overflow fix, filterable account list, per-account LLM usage/spend); **hide get-the-app card in desktop**.

## Reviewers & verdicts (all P1-free)
| Reviewer | Verdict |
|---|---|
| Claims-auditor | PASS-WITH-FIXES (1 P2, 2 P3) → fixed |
| Red-team | CONDITIONAL PASS (1 P2 adjudicated false-positive, 3 P3) |
| Logic-skeptic | PASS (1 P2 → fixed, 7 P3) |
| Cost-auditor | PASS (1 P2 = scale-ahead ticket, 6 P3) |

## P2 findings — resolved or adjudicated (fix commit `9e9067fa`)
- **Claims F-1 (fixed):** the field-study onboarding leaf labeled "Start a field study" routed to `/app/diagnosis`. Changed `ctaPath` → `/app` (where the desktop/field-study guidance lives).
- **Logic D6 (fixed):** the desktop `study:status` listener could leak if the tab tore down before `onEvent`'s promise resolved (ghost-tick). Cleanup now stores the in-flight promise and unsubscribes once it resolves, winning the race regardless of timing.
- **Red-team RPC guard ordering (ADJUDICATED — no change):** the `nibbin_pause/resume/sleep` guard is the **canonical `nibbin_demote` pattern**, already approved byte-for-byte by the dedicated nibbin-mgmt security review. Authenticated callers ARE member-checked (first guard); anon is rejected (second guard); the only non-member-checked path is `service_role` (intended for system calls). No cross-account bypass exists. Not a defect.
- **Cost/Admin `fetchSpendMap` full-scan (ticket, not blocking):** the account-list spend map scans 30 days of `model_calls` across all accounts. Safe at current scale (staff-only, tens/hundreds of accounts); convert to a `GROUP BY` RPC before ~500 active accounts.

## P3 findings — fixed or tracked
- Fixed: NibbinControls "Delete"/"Archive" wording coherence; softened the freeform fallback note ("adapt to your exact chore"); ease-token dedup (`--ease-spring` aliases `--ease-settle`); redundant dashboard 640px override removed; coral hex tokenized; mobile-drawer brand wordmark; admin member-count read.
- Tracked (non-blocking): sleeping-nibbin existence via timing on the pause error path (you already own the id); `choreText` is truncated server-side (bounded); per-module `@keyframes` duplication (CSS-Modules scoping, expected).

## Coverage gap (follow-up)
`freeform.ts` has no injection seam, so the degraded-router / throwing-LLM paths and the `hatchNibbin` fallback cascade are not unit-tested (the cascade LOGIC was logic-reviewed as correct). Follow-up: add an injection seam + fallback tests.

## Binding privacy invariants — verified intact
Capture local-only; deletion verified; model-training two-part/opt-out; secure-fields "by construction"; no "<100ms"; delete=archive (never hard-deleted); quick-scan consent accurately scoped (not "two weeks"); 14-day copy preserved for full study.

## Build/verify notes
- Migration `20260619270000_nibbin_pause_sleep.sql` applied + verified on dev/staging/prod.
- Local-only artifacts (NOT defects, CI-clean): 2 `target/` cargo-artifact eslint errors (gitignored, absent in CI); `@nibbin/*` workspace tsc/build resolution under the junctioned `node_modules` (CI fresh `npm ci` resolves it; `main` builds + deploys).
- Desktop Rust/Tauri changes (D1/D6/D7/D8) are compile-verified (cargo fmt/clippy clean) and **need an on-device desktop build to confirm runtime behavior**.

## Follow-up PR
**Study web-visibility** (study-started signal + `/api/study/status` + in-progress status + diagnosis-ready leaf) is a new cross-app capability with privacy/auth implications + desktop networking — shipped as a focused follow-up PR, not folded into this sweep.

## Final verdict
**PASS** (after fixes). No P1; both fixable P2s resolved; the red-team P2 adjudicated as the canonical pattern; remaining items tracked.
