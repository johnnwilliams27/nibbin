# Adversarial gate — Admin analytics dashboard (sign-up / usage / agent / desktop)

- **Branch / PR:** `feat/admin-analytics-dashboard` → `main`
- **Scope:** `analytics_overview()` + `analytics_daily(int)` RPCs (migration `20260620100000`);
  `apps/admin/lib/analytics/read.ts` (+ test); `apps/admin/app/analytics/page.tsx`; nav links.
- **Part of** the "analytics for Nibbin" directive ([[project_nibbin_analytics_platform]]).

## What it is
A staff-only operational dashboard: waitlist/account sign-ups, active accounts (DAU/WAU/MAU), runs +
30-day approval mix, nibbins-by-stage, a 30-day daily trend, and desktop installer download counts.

## Key classification (deliberate)
These are **internal operational metrics** (running the business), aggregate counts only, no content.
Unlike the fleet-contribution aggregate (`capability_task_performance`, which IS opt-out-gated because
it's user contribution to shared assets), these operational metrics are **staff-only but NOT
opt-out-gated** — same posture as the existing admin accounts/waitlist/scoreboard pages. (The data
stance explicitly allows aggregate de-identified operational analytics.)

## Controls
- **Staff-only:** both RPCs are SECURITY DEFINER, `set search_path=''`, `revoke from
  public/anon/authenticated`, `grant to service_role`. The page asserts `getStaff()` +
  `redirect('/login')` BEFORE `adminClient()` and logs `staff_log_access('analytics.view')`.
- **Aggregate only:** RPCs return counts (no account_id, no user rows, no content).
- **Desktop downloads:** server-side fetch of the PUBLIC GitHub releases API for
  `johnnwilliams27/nibbin-desktop` (no token; hardcoded URL — no SSRF surface), `revalidate:600`,
  shape-guarded, **fail-soft** (`{available:false}` on any error — never throws, page still renders).
- **Web analytics is a SEPARATE PR** (Vercel Web Analytics on nibbin.com) — not in this one.

## Tests
`apps/admin/lib/analytics/read.test.ts` (28): shape guards accept valid / reject drift+NaN;
`approvalRate` null-safe; loaders map + throw-on-drift; `loadDesktopDownloads` sums by platform +
fail-soft on fetch rejection / non-ok / shape drift.

## CI / local
Migration applied + smoke-tested on dev (overview + daily(14)=15 rows). apps/admin tsc clean;
eslint + repo-wide `npm run lint` clean; 28 unit tests pass.

## Verdicts (real 2-reviewer pass — both PASS, no P1/P2)
- **Red-team (opus): PASS** — non-staff cannot reach it (DB revoke + server-only service client + page
  gate, all independent); no per-user/content leak (aggregate counts only); the not-opt-out-gated
  classification is principled (operational counts ≠ fleet contribution); GitHub fetch injection-free,
  tokenless, fail-soft; `p_days` clamp un-bypassable. P3: audit log written after loaders (pre-existing
  scoreboard pattern — left consistent).
- **Logic-skeptic (opus): PASS** — metrics arithmetically correct + self-consistent; series inclusive
  (no off-by-one); DAU/WAU/MAU = rolling distinct-active is sound; stage partition exhaustive; loaders/
  shape-guards/null-safety/render-branch all sound; tests non-vacuous. P3s: Windows `.msi+.exe`
  summation (label nuance), timezone bucketing (cosmetic, self-consistent), `releaseTotal` counted
  non-installer sidecars, N+1 row vs "30d" label.

### Fixes applied (the two actionable P3s)
- `releaseTotal` now counts INSTALLER assets only (`.dmg/.msi/.exe`) — excludes Tauri `.sig`/`latest.json`
  sidecars, so per-release "Downloads" equals the platform-column sum. Regression test added (sidecars
  with download_count 999 each are excluded → total stays 10).
- Relabeled the desktop cards: "macOS (.dmg)" / "Windows (.msi + .exe)" + a caption clarifying these are
  cumulative installer download counts.
Accepted P3s (cosmetic, staff-only, documented): timezone bucketing (UTC, self-consistent), N+1 series
row vs the "30d" label, audit-log-after-loaders (consistent with scoreboard).

**Gate verdict: PASS.** tsc clean; repo lint clean; 29 unit tests.
