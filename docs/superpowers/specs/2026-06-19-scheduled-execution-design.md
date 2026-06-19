# Scheduled execution engine + Training Mode sampling — design

**Date:** 2026-06-19
**Status:** approved (user chose "build the full engine now").
**Scope:** a new Vercel-cron route that fires nibbins' `schedule` triggers on cadence (the FIRST always-on autonomous cadence), with Training Mode sampling folded in. Migration `20260619210000_nibbin_schedule_state.sql`.

## Why
Today only `user` and `event` triggers dispatch. `{kind:'schedule', schedule:'daily.morning'|…}` triggers — defined on templates and Composer specs — are never evaluated or fired. Training Mode (#162) shipped its substrate (`training_sample` RPC, `trainingSampleDecision`, `SupabaseTrainingStore.recordSample`) but nothing consumes it because there is no scheduler. This builds the scheduler and wires training sampling into it.

## Safety framing (load-bearing — this is autonomous execution)
Launching a scheduled run does NOT grant autonomy. Every run still goes through the unchanged runner: School-gated, drafts surface for approval, NO side effect executes before graduation, ceilings + per-run weight budget enforced. Eggs are refused by the runner (`{kind:'not_started', why:'egg'}`). This engine only decides **when to launch**, never what executes. Exactly-once per scheduled occurrence (atomic claim). A per-tick launch cap bounds cost.

## Schedule semantics (single source of truth)
A `SCHEDULE_DEFS` map (new shared const, reused wherever schedule strings are interpreted; cover every value in `COMPOSER_CADENCES` + templates):
| key | rule (in the account's timezone) |
|-----|----|
| `hourly` | minute 0 of every hour |
| `daily.morning` | 08:00 |
| `daily.afternoon` | 13:00 |
| `daily.evening` | 18:00 |
| `weekly.monday` | Monday 08:00 |

Two pure functions (TZ-correct via `Intl.DateTimeFormat`/zone math — unit-tested):
- `latestOccurrence(key, tz, now): Date` — the most recent instant the schedule should have fired, at or before `now`.
- `nextOccurrence(key, tz, now): Date` — the next instant strictly after `now`.

**Day stepping is by CALENDAR DAY in-zone, not by fixed ms (DST-correct).** The
original implementation stepped across days by subtracting a fixed `86_400_000`
ms (and `7×86_400_000` weekly). On the calendar day AFTER a spring-forward
transition (a 23-hour local day), in the 00:00–00:59 local window, that fixed
24h subtraction crossed the lost hour and landed on the WRONG local day, so
`nextOccurrence` could return an instant in the PAST relative to `now` →
`claim_and_advance` set `next_run_at` to a past value → the row re-claimed and
re-fired every 5-min tick (a verified ~13-fire storm where there should be ≤1).
The fix: a `localDayAt(tz, anchor, deltaDays, hour)` helper reads the anchor's
y/m/d in the target zone, adds `deltaDays` to the DATE field (`Date.UTC`
normalizes rollover), then re-resolves the wall-clock target `HH:00` local to a
UTC instant via the verified two-pass `instantForLocal` offset solve. Daily
steps ±1 calendar day; weekly steps ±7 calendar days; `hourly` is pure UTC-hour
truncation and is unaffected. `instantForLocal` itself was correct and is kept.
Regression-guarded by occurrence tests at the spring-forward boundary asserting
the invariant `latestOccurrence(...) <= now < nextOccurrence(...)` (incl. a
5-min brute-force sweep through the dangerous morning).

**Timezone:** resolve the account's zone from the account owner/creator's `users.tz`; fall back to `'UTC'` when absent. Cache per account per tick.

## State + exactly-once (migration)
`nibbin_schedule_state` — one row per (nibbin, schedule_key):
```
nibbin_id    uuid  not null references nibbins(id)  on delete cascade
account_id   uuid  not null references accounts(id) on delete cascade
schedule_key text  not null
next_run_at  timestamptz not null   -- the occurrence we're waiting to fire
last_fired_at timestamptz
primary key (nibbin_id, schedule_key)
```
- RLS: member-read for observability; `insert/update/delete` REVOKEd from `authenticated`. Writes only via service-role definer RPCs (`search_path=''`).
- Index on `(next_run_at)` for the due scan.
- **`schedule_seed(p_nibbin, p_account, p_schedule_key, p_next_run_at)`** — `insert … on conflict (nibbin_id, schedule_key) do nothing`. Seeds a *future* occurrence; never fires on first sight (adoption already does a first-run).
- **`schedule_claim_and_advance(p_nibbin, p_schedule_key, p_now, p_next_run_at) returns boolean`** — `update … set last_fired_at = p_now, next_run_at = p_next_run_at where nibbin_id = p_nibbin and schedule_key = p_schedule_key and next_run_at <= p_now; return FOUND;`. **Exactly-once:** the first concurrent cron's update advances `next_run_at` into the future, so a second concurrent cron's `where next_run_at <= now` matches 0 rows → `false`. Catch-up-safe: after a missed tick it fires once, not N times.

No new column on `runs`; no change to `run_begin`. The existing debounce/cooldown remains a secondary guard.

## The cron route — `apps/web/app/api/cron/nibbin-schedule/route.ts`
Mirror `connector-poll` exactly: `import 'server-only'`, `dynamic='force-dynamic'`, `maxDuration=60`, `isAuthorizedCronRequest(req)` → 401 if not, `serviceClient()`.

Per invocation (a TWO-PHASE due-first scan — see "Coverage / fairness" below):
1. **Claim phase — DUE-FIRST.** `dueScheduleOccurrences(svc, now, DUE_SCAN_LIMIT)` reads `nibbin_schedule_state` where `next_run_at <= now`, **ORDER BY `next_run_at` ASC**, inner-joined to the (active) nibbin + adopted spec, bounded by `DUE_SCAN_LIMIT` (200). This uses the `nibbin_schedule_state_next_run_idx` index. For each due (nibbin, key): `schedule_claim_and_advance(nibbin, key, now, nextOccurrence(key, tz, now))`; on `true` → `triggerNibbinRun(nibbin.id, { kind:'schedule', key })`. (Egg → runner returns `not_started`/`egg`; counted, not an error.)
2. **Seed phase — bounded DISCOVERY.** `seedCandidateNibbins(svc, SEED_DISCOVERY_LIMIT)` reads active nibbins whose `agent_specs.triggers` jsonb **contains** `[{"kind":"schedule"}]` (SQL containment filter, BEFORE the limit), **ORDER BY `created_at` DESC** (newest-first so new nibbins seed promptly), anti-joined in TS against existing state rows. For each candidate (nibbin, key) lacking a row → `schedule_seed(nibbin, account, key, nextOccurrence(key, tz, now))` (a FUTURE occurrence; never fires this tick — adoption already did a first run, and the next tick's claim phase picks it up fairly when due).
3. Resolve each account's tz once per tick (cached).
4. **Training sampling** — over the nibbins SEEN this tick (due ∪ seed candidates). Load each one's active window; cheap `trainingSampleDecision(window, stage, now)` pre-check (skips egg/inactive), then `trainingStore.recordSample(window, now)` (RPCs `training_sample`, atomic consume, service-role). **Consume-then-fire:** only if the RPC actually consumed a unit do we `triggerNibbinRun(nibbin.id, { kind:'schedule', key:'training.sample' })`. At most ONE extra sampled run per nibbin per tick. **A nibbin that base-fired THIS tick is SKIPPED before `recordSample`** (see "Training budget" below). Bounded by the window's `max_runs` (≤100), ≤3 windows/account, and the time box.
5. **Global per-tick launch cap** (`MAX_LAUNCHES_PER_TICK`, e.g. 100) across base + sampled to bound a cold-start thundering herd; log deferrals (they fire next tick — claim state is unadvanced for un-launched base rows because we only advance on a fired claim... so deferred base rows stay due and fire next tick).
6. Return `{ scanned, fired, sampled, deferred, errors, scanCapped, seedCapped }`.

### Coverage / fairness (the due-first scan)
The first implementation loaded `.eq('status','active').order('created_at ASC').limit(200)` and filtered schedule triggers in TS AFTER the limit, with no rotation. Once an install exceeded 200 active nibbins, every scheduled nibbin past the 200th-oldest was **never scanned, seeded, or fired** — silently and permanently. The due-first claim scan orders by `next_run_at` and uses the index, so the OLDEST-DUE occurrence always wins a slot — no due nibbin is permanently starved. The seed phase is newest-first discovery (a one-time concern: once seeded a nibbin leaves the candidate set and enters the fair claim phase). **Both caps are surfaced, never silently truncated:** when the claim scan returns exactly `DUE_SCAN_LIMIT` rows or the seed scan returns exactly `SEED_DISCOVERY_LIMIT`, the tick sets `scanCapped`/`seedCapped` in the JSON response AND `console.warn`s it (mirroring the launch-cap warning).

### Training budget (no wasted unit on a base-fired nibbin)
In one tick a nibbin could fire its base scheduled run (setting `runs.started_at`) AND then be training-sampled; the sampled `triggerNibbinRun` hits the runner's per-nibbin cooldown → `not_started:cooldown`, but `recordSample` already consumed a budget unit — a wasted unit (not unsafe, but it burns the user's bounded training budget for nothing). The tick now tracks a `firedBase` set of nibbin ids that launched a base run this tick and SKIPS them in the sampling loop **before** calling `recordSample`, so no unit is spent.

**Vercel cron:** add to `apps/web/vercel.json`: `{ "path": "/api/cron/nibbin-schedule", "schedule": "*/5 * * * *" }`.

## Tests
- **Pure occurrence math:** `latestOccurrence`/`nextOccurrence` for each key across ≥2 timezones (e.g. `UTC`, `America/New_York`), a weekly case, an hourly case, and a day-boundary case. Assert TZ-correctness (08:00 local ≠ 08:00 UTC).
- **DST regression (calendar-day stepping):** occurrence tests at the spring-forward boundary (`daily.morning` and `weekly.monday` in `America/New_York`) asserting `latest <= now < next` and the correct local days/hours, plus a 5-min brute-force sweep through the dangerous morning asserting `next > now` at every step; a fall-back (autumn) case for symmetry.
- **Claim exactly-once:** via a fake store mirroring the conditional-update — a second claim for the same occurrence returns `false`; the run fires once.
- **Route logic (fake stores/seams):** a due nibbin fires once and advances; a not-due nibbin doesn't (its future row isn't returned by the due scan); a freshly-discovered nibbin seeds a future occurrence and doesn't fire this tick; an egg's `not_started` outcome is handled cleanly; a nibbin with an open training window whose `recordSample` consumes a unit fires one extra sampled run; a closed/exhausted window fires none; the per-tick cap defers excess.
- **Due-first fairness + caps:** the due scan claims oldest-due first; `scanCapped` is set when the due scan returns its full limit; `seedCapped` is set when the seed scan returns its full limit.
- **Training budget (FIX 3):** a nibbin that base-fired this tick is NOT also sampled — `recordSample` is never called for it and no unit is consumed.
- **Auth:** unauthorized request → 401.

## Verification
- `tsc -p packages/runtime` + `-p apps/web` → 0
- `vitest run` (scheduler tests + existing runtime/web suites) → green
- `eslint …` clean · `npm run build -w @nibbin/web` → Compiled successfully

## Migration
`20260619210000_nibbin_schedule_state.sql` — table + 2 definer RPCs (`search_path=''`), RLS member-read, writes REVOKEd from authenticated, no public VIEW. Applied to dev/staging/prod at merge.

## Out of scope (deliberate)
- Per-(nibbin,user) multi-timezone fan-out (one account tz for v1).
- `NIBBIN_REINFORCEMENT` flip / 2nd eval-cleared model (separate eval/product decision — NOT autonomous).
- Sub-5-minute schedule granularity; cron-expression custom schedules.
