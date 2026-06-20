# Adversarial Gate — Field-Study Web Visibility

**Date:** 2026-06-19
**Branch:** `feature/study-visibility`
**Scope:** Desktop posts a minimal study-lifecycle signal → `/api/study/status` → `study_status` table; grove-home "in-progress / Watching" card; "study started" + "diagnosis-ready" leaves. Also folds in two UI bug fixes (keeper avatar overflow, NotificationCenter mobile cutoff).
**Sensitive paths touched:** `supabase/migrations/`, `apps/web/app/api/` → gate mandatory.

## Verdict: PASS (after fixes)

Four independent reviewers ran against the full branch diff.

| Reviewer | Result |
|---|---|
| Red-team (auth/privacy) | Clean — no P1/P2 |
| Claims-auditor | Clean — no P1/P2; all 5 claims real |
| Logic-skeptic | 2 P2 (fixed) |
| Cost-auditor | Clean — no P1/P2 |

## Key invariant check (red-team)
The feature deliberately relaxes "capture is local-only" by egressing **minimal lifecycle metadata only** (`study_id, kind, label, status, started_at, ends_at`). Verified:
- `label` is **user-typed task intent** (consent / quick-scan text input), not captured-content-derived.
- AuthZ: written `account_id` comes from `ensureAccount` (authenticated session), never the request body → no cross-account write.
- AuthN: `getUser()` validates the JWT; anon / invalid / expired → 401.
- RLS: member-read only; `revoke insert/update/delete` from authenticated; `revoke all` from anon; writes are service-role only.
- Enums whitelist-checked; `label` length DB-capped (120); all writes parameterized (no injection).
The privacy moat (captured content stays local; only minimal lifecycle metadata egresses) is preserved.

## Claims verified (claims-auditor)
Route upserts + emits leaf; `page.tsx` queries + renders a real countdown; `packet/route.ts` emits the diagnosis-ready leaf; desktop start + both stop paths call `postStudyStatus` with correct values. **Critical:** `insert_system_notification` RPC signature matches the established callers byte-for-byte → leaves will fire. Distinct `source_id` prefixes; idempotent by `(account_id, kind, source_id)`.

## P2 findings — FIXED
**P2-1 / P2-2 — stale "Watching" card + countdown shows "running" when expired.**
Root cause: the card keyed solely on `status='active'`, which the desktop flips to `stopped` via a best-effort POST that (a) is never sent on the day-14 auto-stop / quick-scan backstop, and (b) is dropped when offline. A finished study rendered a permanent "Full field study — running" card.

**Fix (commit `f7759913`):** the web now self-heals. `isStudyActiveNow()` treats a passed `ends_at` (and a stale open-ended row, via `started_at` + a 6h cap) as ended, so the card lifecycle no longer depends on the desktop stop signal. `studyCountdown` is only called for genuinely-active studies.

## P3 findings — accepted / tracked
- `status` CHECK allows `'paused'` but the route enum doesn't accept it — intentional forward-compat; desktop never sends it.
- `started_at`/`ends_at` are only `typeof`-checked, not date-validated — scoped to the caller's own row, tolerated downstream (NaN → "running"). Cosmetic.
- Consent-flow start race: mostly closed (`start` await sets timestamps synchronously); residual no-retry gap shares the same root cause as P2-1 and is now masked by the web self-heal. **Follow-up:** have the desktop daemon emit `stopped` on all terminal transitions (day-14, backstop, delete) so the server clears faster than the staleness window.

## Migration
`20260619320000_study_status.sql` applied + verified on dev / staging / prod (RLS on, 1 member-read policy each).
