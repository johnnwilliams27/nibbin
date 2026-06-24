# Adversarial Gate — GTM Link Tracking

**Date:** 2026-06-23
**Branch:** `feature/gtm-link-tracking`
**Base commit reviewed:** `9ba119ce` (fixes in a follow-up commit on the same branch)
**Reviewers:** red-team, claims-auditor, logic-skeptic, cost-auditor (4/4 run on the rebased diff vs `origin/main`)
**Trigger:** diff touches `apps/web/app/*` (route handler) + `supabase/migrations/` — gate-required per AGREEMENTS §6.7.

## Scope

New feature: `/r/[code]` redirect logs a click as a `product_events` row then 302s to the
landing page with UTM; the waitlist server action captures first-touch UTM; a staff-only
`analytics_gtm_funnel()` RPC + an admin dashboard card surface clicks→signups by source.
Migration `20260623120000_gtm_link_tracking.sql`: nullable UTM columns on `waitlist`,
`analytics_gtm_funnel()`, and `waitlist_join()` (added in the fix pass).

Design note (disclosed): the original ticket spec'd a dedicated `link_hits` table with
hashed IP/referrer/UA. The implementation instead logs `product_events(name='link_click')` —
no new PII-bearing table, reusing the append-only/retention/service-role machinery. The
`link_hits`-specific DoD lines are intentionally not met; the simpler design is the safer one.

## Verdict: **PASS** — no P0/P1. All P2s fixed; P3s fixed or consciously accepted.

## Findings & disposition

| # | Sev | Reviewer | Finding | Disposition |
|---|-----|----------|---------|-------------|
| 1 | P2 | logic-skeptic | First-touch attribution TOCTOU: `isNew` from a SELECT then a client upsert is last-writer-wins under concurrent first-submits; explicit-null spread could clobber a racer's real UTM; double `waitlist_joined` event possible. Comment overstated the guarantee. | **FIXED** — replaced with atomic `waitlist_join()` RPC: `INSERT … ON CONFLICT DO UPDATE SET utm = COALESCE(existing, excluded)` (first non-null source wins), `RETURNING (xmax=0)` for a reliable `is_new` so the event fires exactly once. Validated on dev (below). |
| 2 | P2 | red-team + cost-auditor | `/r/[code]` is public/unauthenticated and writes a row per hit — link-preview crawlers/scrapers pollute the click→signup conversion (the metric the feature exists for). | **FIXED (coarse)** — `isLikelyBot(ua)` skips the click log for empty/bot UAs (Slack/Telegram/FB unfurls, curl/wget, headless, crawlers). Kills accidental inflation; a determined attacker is out of scope for v1 (see Outstanding). |
| 3 | P3 | claims-auditor | The pure helpers are well-tested, but the attribution-capture logic (first-touch upsert + form sessionStorage) — the part the ticket called "silently breaks if skipped" — was untested. | **FIXED** — first-touch is now DB-atomic and validated on dev; the form's first-touch decision was extracted to a pure `pickFirstTouchUtm()` and unit-tested (4 cases). |
| 4 | P3 | logic-skeptic | A malformed-but-valid-JSON stored value (right type, no real UTM) would suppress fresh URL attribution for the session. | **FIXED** — `pickFirstTouchUtm()` only prefers stored UTM when it carries a non-empty value, else falls back to the URL. Unit-tested. |
| 5 | P3 | logic-skeptic | Per-video codes (`photographer-01`, …) each become their own `source` row in the funnel rather than rolling up. | **ACCEPTED (conscious)** — only `tt/ig/x` bio codes exist today; counts are accurate, just granular. Revisit (group video codes by `medium`) if/when per-video codes are minted. |
| 6 | P2 | red-team + cost | (Same root as #2) residual: a determined attacker can still inflate counts past the UA filter; unbounded row growth. | **ACCEPTED / Outstanding** — low blast radius (no PII, no redirect abuse, staff-internal metric); §6.11 retention bounds growth. Tracked as a post-merge follow-up (rate-limit / per-(code,day) collapse / WAF). |

**Confirmed clean (no findings):** open-redirect (relative-path-by-construction, `CODE_RE`
gate, `URLSearchParams` encoding), SQLi (PostgREST parameterized; RPCs static SQL), stored
XSS (allowlist + React text escaping), RLS/grants (`analytics_gtm_funnel`/`waitlist_join`
`security definer` + `set search_path=''` + revoke public/anon/authenticated + grant
service_role only — same posture as `analytics_overview`), PII (events carry only code+UTM;
no IP/email/UA/content), funnel SQL correctness (FULL OUTER JOIN + coalesce, deterministic
order, no double-count), div-by-zero (conversion null-guards clicks=0), admin `Promise.all`
(no N+1), funnel scan cost (existing `product_events_name_idx` covers the `name` filter — no
new index needed).

## Verification evidence

- **Unit tests:** `tests/unit/gtm-links.test.ts` — 18/18 green (code→UTM mapping, open-redirect
  rejection, UTM sanitizer, `isLikelyBot`, `pickFirstTouchUtm` first-touch + stale-JSON fallback). TDD (watched red→green).
- **Dev migration applied + validated** (`oqnqzytctwlptfdvyagl`):
  - 4 UTM columns present on `waitlist`; `analytics_gtm_funnel()` runs; grants = postgres+service_role only.
  - Funnel round-trip: 2 `link_click` events + 1 attributed signup → `tiktok: clicks=2, signups=1`.
  - `waitlist_join` first-touch: `join('…','tiktok',…)` → `is_new=true`; second `join('…','instagram',…)`
    → `is_new=false`; stored row kept `utm_source=tiktok, ref=tt` (first-touch preserved, not clobbered).
  - All test rows deleted; dev left clean.
- **Lint:** changed files clean. **Typecheck:** `apps/admin` clean; `apps/web` only pre-existing
  env errors (missing optional deps + a Windows path-casing artifact), none in changed files.

## Outstanding (post-merge)

- **Staging + prod migration:** apply `20260623120000_gtm_link_tracking.sql` to staging
  (`swbbydpuiilnamnyhwnr`) + prod (`oaymttudfazqaqequrke`) at merge; verify via information_schema.
- **Finding #6:** determined-abuse hardening on `/r/*` (rate-limit or per-(code,day) collapse or
  WAF rule). Low priority for the launch sprint; flag if click numbers look inflated.
