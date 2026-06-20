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

## Verdicts
(appended after the reviewer pass)
