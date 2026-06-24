# Task 1 Report — RLS/RPC Attack Suite for Stakes Change

**Date:** 2026-06-23
**Branch:** feature/company-brain-attention-queue
**File:** `tests/rls/attention-queue-stakes.test.ts`

---

## Status

PASS — 14/14 tests green. 8 attack assertions added; 6 Task-0 tests left intact.

---

## Coverage Map

### Already covered by Task 0 (preserved, not duplicated)

| Test | Assertion |
|------|-----------|
| 1a | `insert_system_notification` with no `p_stakes` → `stakes='normal'` |
| 1b | `insert_system_notification` with `p_stakes='high'` → `stakes='high'` |
| 1c | `insert_system_notification` with `p_stakes='critical'` raises |
| 1d | `propose_memory_change` with `p_stakes='high'` propagates to notification row |
| 1e | `propose_memory_change` without `p_stakes` (7-arg, backward-compat) → `stakes='normal'` |
| 1f | Authenticated client cannot INSERT into `notifications` directly |

### Added by Task 1 (attack assertions)

| Test | Attack / Coverage gap |
|------|-----------------------|
| 1g | **Anon INSERT blocked** — anon role cannot insert into `notifications` directly (closes the gap in 1f which only covered `authenticated`) |
| 1h | **Authenticated UPDATE stakes blocked** — authenticated client cannot UPDATE `notifications.stakes` to escalate priority; INSERT block alone is insufficient if UPDATE is open |
| 1i | **Anon UPDATE stakes blocked** — anon role cannot UPDATE `notifications.stakes` either |
| 1j | **Cross-account isolation (negative)** — user B cannot see user A's notification rows (including the `stakes` column) |
| 1k | **Cross-account isolation (positive + negative)** — user B sees their own notification with correct `stakes` value, AND cannot see A's notification by `source_id` lookup |
| 1l | **Kind allowlist still enforced** — `insert_system_notification` rejects forged kinds `system_alert`, `admin_notice`, `marketing`; the new `p_stakes` param did not relax the guard |
| 1m | **Kind allowlist regression — nudge/demotion still allowed** — verifies the 7-arg replacement function still accepts all 3 permitted kinds without error |
| 1n | **Invalid stakes through `propose_memory_change` wrapper** — 1c tested `insert_system_notification` directly; this test exercises the full call chain to confirm the validation error propagates up through `propose_memory_change` |

---

## Holes Found

None. The migration is sound:

- `notifications` RLS prevents all direct client writes (INSERT + UPDATE) regardless of the new `stakes` column.
- The `insert_system_notification` kind allowlist (`nudge`, `demotion`, `review_item`) is unchanged and still enforced before stakes validation; a forger cannot route a bad kind in.
- The `check (stakes in ('normal', 'high'))` constraint on the column is redundant with the PL/pgSQL guard in `insert_system_notification`, but both fire correctly — belt-and-suspenders.
- Cross-account RLS isolation is not weakened by the new column.

---

## Concerns

None blocking. One observation: the column-level CHECK constraint (`check (stakes in ('normal', 'high'))`) would fire on a direct INSERT if RLS were ever misconfigured, but the actual guard that fires in tests is the PL/pgSQL `RAISE EXCEPTION` inside the function (the RLS permission-denied fires first for client roles). The dual-guard is a net positive.

---

## Test Run

```
Tests  14 passed (14)
Duration  2.52s
```

Command: `npx vitest run tests/rls/attention-queue-stakes.test.ts`
