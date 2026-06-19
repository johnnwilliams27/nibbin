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

Per invocation:
1. **Load** all `status='active'` nibbins with specs (cross-account; add `activeScheduledNibbins(svc, limit)` to engine.ts, or inline the `nibbins … agent_specs!inner(*)` query) and keep only those whose `spec.triggers` contains a `schedule` trigger. Bound with a `LIMIT` (e.g. 200) for cost/fairness; log if capped.
2. Batch-load this set's `nibbin_schedule_state` rows and resolve each account's tz once.
3. **Base cadence** — for each (nibbin, schedule trigger):
   - no state row → `schedule_seed(nibbin, account, key, nextOccurrence(key, tz, now))` (no fire).
   - state row with `next_run_at <= now` → `schedule_claim_and_advance(nibbin, key, now, nextOccurrence(key, tz, now))`; if it returns `true` → `triggerNibbinRun(nibbin.id, { kind:'schedule', key })`. (Egg → runner returns `not_started`/`egg`; counted, not an error.)
4. **Training sampling** — load active windows (`training_sessions` where `ended_at is null and now() < expires_at`) for active nibbins; for each: cheap `trainingSampleDecision(window, stage, now)` pre-check (skips egg/inactive), then `trainingStore.recordSample(window, now)` which RPCs `training_sample` (atomic consume, service-role). **Consume-then-fire:** only if the RPC actually consumed a unit (window still open, budget left) do we `triggerNibbinRun(nibbin.id, { kind:'schedule', key:'training.sample' })`. At most ONE extra sampled run per nibbin per tick. Bounded by the window's `max_runs` (≤100), ≤3 windows/account, and the time box.
5. **Global per-tick launch cap** (`MAX_LAUNCHES_PER_TICK`, e.g. 100) across base + sampled to bound a cold-start thundering herd; log deferrals (they fire next tick — claim state is unadvanced for un-launched base rows because we only advance on a fired claim... so deferred base rows stay due and fire next tick).
6. Return `{ scanned, fired, sampled, deferred, errors }`.

**Vercel cron:** add to `apps/web/vercel.json`: `{ "path": "/api/cron/nibbin-schedule", "schedule": "*/5 * * * *" }`.

## Tests
- **Pure occurrence math:** `latestOccurrence`/`nextOccurrence` for each key across ≥2 timezones (e.g. `UTC`, `America/New_York`), a weekly case, an hourly case, and a day-boundary case. Assert TZ-correctness (08:00 local ≠ 08:00 UTC).
- **Claim exactly-once:** via a fake store mirroring the conditional-update — a second claim for the same occurrence returns `false`; the run fires once.
- **Route logic (fake stores/seams):** a due nibbin fires once and advances; a not-due nibbin doesn't; a freshly-seeded nibbin doesn't fire this tick; an egg's `not_started` outcome is handled cleanly; a nibbin with an open training window whose `recordSample` consumes a unit fires one extra sampled run; a closed/exhausted window fires none; the per-tick cap defers excess.
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
