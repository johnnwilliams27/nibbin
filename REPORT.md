# Drip Bug Fix Report — fix/bug-drip

## #45 — diagnosis_reveal branches on study lifecycle, not studyActive flag

**Files:**
- `packages/drip/src/types.ts` — added `studyCompleted: boolean` to `ArcFlags`
- `packages/drip/src/pg-arc-data.ts` — `flags()` computes `studyCompleted` (latest event === study_completed)
- `packages/drip/src/ceremonies.ts` — `buildDiagnosisReveal` has three branches:
  - `studyCompleted=true` → "Your diagnosis is ready" + `/app/diagnosis` CTA
  - `studyActive=true` → "Still watching" copy
  - neither → pitch Field Study ("Your grove, one fortnight in")
- `packages/drip/src/stub.ts` — default stub includes `studyCompleted: false`

**Migration SQL:** none.

**Tests:** 3 unit tests + 1 arc integration test (arc.test.ts, #45 describe block).

---

## #42 — unbounded nibbins.name bricks drip for 30 days

**Files:**
- `supabase/migrations/20260620140000_nibbin_name_length_cap.sql` — NEW:
  - backfill: `UPDATE nibbins SET name = left(name, 150) WHERE char_length(name) > 150`
  - constraint: `ALTER TABLE nibbins ADD CONSTRAINT nibbins_name_max_length CHECK (char_length(name) <= 150)`
- `packages/drip/src/pg-store.ts` — title truncation (slice to 197 + ellipsis) in both `insertEarnedNotification` and `insertBeatNotification`
- `packages/drip/src/worker.ts` — per-event try/catch in earned-event loop; errors call onError and continue

**Migration SQL:** `supabase/migrations/20260620140000_nibbin_name_length_cap.sql` — controller applies after review.

**Tests:** 2 new tests in arc.test.ts (#42 describe block).

---

## #41 — 20h spacing-floor race under concurrent tz-flip claims

**Files:**
- `packages/drip/src/pg-store.ts` — `claimSend` uses a CTE that calls `private.lock_account($1::uuid)` before the INSERT, serializing claims per account within a transaction. Lock helper confirmed at migration line 275: `private.lock_account(target_account uuid) returns void`.

**Migration SQL:** none — `private.lock_account` exists in M4.

**Tests:** existing concurrent-tick and stale-worker tests cover the guard path.

---

## #40 — tz guard case-sensitive

**Files:**
- `packages/drip/src/pg-arc-data.ts` `nibbinDay()` query:
  - Before: `u.tz in (select name from pg_timezone_names)`
  - After: `lower(u.tz) in (select lower(name) from pg_timezone_names)`

**Migration SQL:** none.

**Tests:** SQL contract test via pool mock (arc.test.ts, #40 describe block).

---

## #39 — earnedEvents breaks since-last-tick contract

**Files:**
- `packages/drip/src/types.ts` — `DripStore.insertEarnedNotification` returns `Promise<boolean>` (true=inserted, false=skipped)
- `packages/drip/src/pg-store.ts` — returns `(r.rowCount ?? 0) === 1`
- `packages/drip/src/worker.ts` — `if (inserted) result.earnedNotifications += 1`
- `packages/drip/test/arc.test.ts` — in-memory store returns `boolean`

**Note:** Insert-report approach (via ON CONFLICT DO NOTHING rowCount) achieves the same correctness as a high-water mark at zero schema cost.

**Migration SQL:** none.

**Tests:** cumulative earnedNotifications=1 test across 3 days (arc.test.ts, #39 describe block).

---

## Gate results

| Check | Result |
|-------|--------|
| `npm run lint` | PASS |
| `npx tsc -p apps/web` (drip files) | PASS (0 new errors) |
| `npx vitest run packages/drip` | PASS (37/37) |

## Concerns

1. **#41 lock in tests:** The in-memory store cannot replicate Postgres advisory lock semantics. The fix is correct at the DB level; integration-harness testing would be needed to verify the race is truly closed.
2. **#40 AT TIME ZONE:** Postgres normalises `AT TIME ZONE` case-insensitively, so non-canonical tz values still work in the bound expression.
3. **Migration sequencing:** The nibbins name-cap migration should run before the drip worker upgrade to avoid a window where old long names can still enter.
