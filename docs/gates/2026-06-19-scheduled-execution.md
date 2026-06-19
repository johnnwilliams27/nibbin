# Adversarial Gate Report — Scheduled-execution engine + Training Mode sampling

**Date:** 2026-06-19
**Branch:** `feat/scheduled-execution` (off main incl. #163)
**Surface:** the FIRST always-on autonomous cadence — a Vercel-cron route that fires nibbins' `{kind:'schedule'}` triggers, with Training Mode sampling wired in. Migration `20260619210000_nibbin_schedule_state.sql` (table + 2 service-role definer RPCs). Ships ENABLED (the cron runs in prod once merged + migration applied).
**Reviewers (3 lenses):** red-team · logic-skeptic · cost-auditor. (Full panel because this is autonomous execution with cost implications.)
**Verdict: PASS** — one P1 (DST re-fire storm) found by logic-skeptic + supporting P2/P3s, ALL fixed in-branch (`ad4829d`) and re-verified.

## What it is
Today only `user`/`event` triggers dispatch; `{kind:'schedule'}` triggers were never fired. This builds the scheduler: a cron route resolves each nibbin's schedule (`daily.morning`=08:00, `daily.afternoon`=13:00, `daily.evening`=18:00, `weekly.monday`=Mon 08:00, `hourly`) in the account's timezone, and fires due occurrences via the unchanged `triggerNibbinRun`. **Grants no autonomy:** every run rides the unchanged School-gated runner (no side effect before graduation; eggs refused). Exactly-once per occurrence via an atomic conditional-claim RPC. Training Mode sampling consumes the `training_sample` budget atomically and fires ≤1 extra supervised run per nibbin per tick.

## Findings — all fixed in-branch (`ad4829d`)
| Lens | Sev | Issue | Fix |
|------|-----|-------|-----|
| logic-skeptic | **P1** | **DST spring-forward re-fire storm.** Day-stepping used fixed `86_400_000` ms. On the 23-hour spring-forward day, in the 00:00–00:59 local window, the fixed-24h step crossed the lost hour → `nextOccurrence` returned a PAST instant → `claim_and_advance` set `next_run_at` to the past → the row re-claimed+fired every 5-min tick (verified ~13 fires where there should be ≤1), once/year per spring-forward zone. The exact autonomous runaway the design claims to prevent. | `localDayAt(tz, anchor, deltaDays, hour)` steps by CALENDAR DAY in-zone (reads y/m/d in-zone, adds `deltaDays` to the date field, re-resolves via the verified two-pass `instantForLocal`). Daily ±1 day, weekly ±7 days; `hourly` (UTC truncation) unaffected. Regression-guarded by spring-forward boundary tests + a 5-min brute-force sweep asserting `latest <= now < next`. |
| red-team + cost-auditor | P2 | **Silent permanent starvation past 200 nibbins.** `activeScheduledNibbins` ordered by `created_at ASC` + `limit(200)` with the schedule filter in TS AFTER the limit and no rotation → scheduled nibbins past the 200th-oldest were never scanned/fired, silently. The `next_run_at` index was unused. | Two-phase: **claim phase** `dueScheduleOccurrences` scans `nibbin_schedule_state where next_run_at <= now ORDER BY next_run_at ASC` (uses the index → oldest-due always wins, no starvation), joined to active nibbins; **seed phase** `seedCandidateNibbins` discovers active schedule-carriers via SQL jsonb containment `@> '[{"kind":"schedule"}]'` BEFORE the limit, newest-first, anti-joined against existing state. `scanCapped`/`seedCapped` booleans surfaced in the response + `console.warn` (no silent truncation). |
| red-team | P3 | a nibbin that base-fires AND is training-sampled in the same tick wastes a budget unit (the sampled run bounces off the runner cooldown). | `runScheduleTick` tracks a `firedBase` set; the sampling loop skips those nibbins BEFORE `recordSample`, so no unit is consumed for a run that would just be dropped. |

### Verified correct (no finding)
- **Auth:** `isAuthorizedCronRequest` gates before any DB work / run launch (401), identical to the other crons; zero client input (cron-only).
- **Autonomy boundary:** only calls `triggerNibbinRun`; program selection is spec-driven (the `training.sample` key cannot mis-select a program); eggs → `not_started`; no side effect escapes the School gate.
- **Exactly-once (non-DST):** the conditional `update … where next_run_at <= p_now … return found` is atomic — a 2nd concurrent claim matches 0 rows; late/missed tick fires once (advances one occurrence), not N. Seed registers a FUTURE occurrence (never fires on first sight).
- **Cross-account/RLS:** table RLS member-read; seed/claim RPCs `security definer set search_path=''`, service-role-only (NOT granted to authenticated). No cross-account path.
- **Consume-then-fire:** `recordSample` (consume) precedes `triggerRun`; the consumed-check is staleness-proof (absolute `runsUsed`); a closed/expired/over-budget window fires zero; `max_runs` (≤100) is atomically enforced (`FOR UPDATE`).
- **Cost:** per-tick launches hard-capped (`MAX_LAUNCHES_PER_TICK`); each run is budget-drawn + ceiling-bounded as today; no new unbudgeted model call; deferred base rows re-fire once (no double-spend).

## Verification (post-fix)
- `tsc -p packages/runtime` + `-p apps/web` → 0
- `vitest run packages/runtime/test apps/web/lib apps/web/app` → **794 passed**; the schedule + cron-route suites → **37 passed** (incl. DST sweep + exactly-once + consume-then-fire + base-fired-skip + 401)
- `eslint …` clean · `npm run build -w @nibbin/web` → Compiled successfully (cron route registered)

## Migration
`20260619210000_nibbin_schedule_state.sql` — `nibbin_schedule_state` table (account-scoped, RLS member-read, writes REVOKEd from authenticated) + `schedule_seed` / `schedule_claim_and_advance` security-definer service-role-only RPCs (`search_path=''`), `next_run_at` index. No public VIEW. **Applied to dev / staging / prod** 2026-06-19.

## Operational note
This turns on scheduled execution product-wide. All runs are supervised/School-gated (no side effects without approval). Coverage is fair (due-first) and bounded (per-tick cap); the cap-surfacing booleans should be watched as active scheduled nibbins grow. `NIBBIN_REINFORCEMENT` / a 2nd eval-cleared model remain a separate, deliberate (non-autonomous) eval decision — out of scope here.
