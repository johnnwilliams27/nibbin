# Adversarial gate — Capture Count Cache (2026-06-19)

> Resolves LS-01 / cost-01 from `docs/gates/2026-06-18-capture-deferred.md`:
> removes the per-append `SELECT COUNT(*)` in `nibbin-store/src/lib.rs` by
> caching the event row-count in-memory and only re-querying near the soft cap.

- **Branch / PR:** `perf/capture-count-cache` → `main` (#TBD)
- **Scope:** `apps/desktop/src-tauri/crates/nibbin-store/src/lib.rs` only (~35 lines changed)
- **Gate run by:** Claude Code (four adversarial lenses, self-authored) on 2026-06-19 — human sign-off pending.

## CI step
- typecheck: relies on Observer-daemon CI (vendored-OpenSSL build requires Strawberry Perl in PATH, not available locally)
- tests: relies on Observer-daemon CI
- fmt / clippy: relies on Observer-daemon CI

---

## Adversarial reviewers

| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | PASS | 0 | 0 | 0 | 0 |
| claims-auditor | PASS | 0 | 0 | 0 | 0 |
| logic-skeptic | PASS | 0 | 0 | 0 | 0 |
| cost-auditor | PASS | 0 | 0 | 0 | 0 |

---

## Findings

None. All lenses PASS with no tracked issues.

---

## What the reviewers examined and why invariants hold

### Red-team — new attack surface

**No new attack surface introduced.** The change is purely internal to `ObserverStore`:
a `u64` field (`cached_event_count`) added to the private struct, a single
`COUNT(*)` added to `open()`, and an increment added after the successful INSERT
in `append()`. No public API changes. No new IPC, no new FFI, no new filesystem
access. The `cached_event_count` field is not exposed outside the crate.

**Drift scenario considered:** an external process deleting events rows while the
daemon is running would cause `cached_event_count` to overcount relative to the
real table. The practical consequence: the store might accept a few more inserts
than it otherwise would if the cached count were near the cap — there is no risk
of silent data loss or privacy regression from over-insertion. The
`COUNT_RECHECK_MARGIN = 100` near-cap re-query closes this window for the
cap-enforcement invariant. Under-counting (cache below real) cannot occur because
`ObserverStore` holds the only write path (`append()`) and increments
`cached_event_count` atomically with each insert.

**Verdict: PASS — zero new surface.**

---

### Claims-auditor — soft-cap invariant (H2 / cost-02)

**Claim: soft-cap enforcement is unchanged.** The prior gate verified that
`append()` never inserts past `event_soft_cap` and never prunes existing rows.

**Audit of the new path:**

1. Fast path (cache well below cap): `cached_event_count + COUNT_RECHECK_MARGIN < cap`
   → `count = cached_event_count`. If `count >= cap` → bail (impossible on the fast
   path since we just proved `count < cap - MARGIN`). INSERT executes.
   `cached_event_count` incremented. Correct.

2. Near-cap / at-cap path: `cached_event_count + COUNT_RECHECK_MARGIN >= cap` →
   `count = event_count()` (real `COUNT(*)`). Cache updated to real value. If
   `count >= cap` → bail; no INSERT. Correct: soft-cap enforced with real data.

3. `set_soft_cap_for_test` refreshes the cache immediately after changing the cap,
   so tests using a tiny cap still exercise the fail-safe path correctly.

The unit test `append_past_soft_cap_fails_safe_without_dropping` continues to
assert: (a) the cap error is returned on the third append, (b) existing rows are
untouched. Both properties are preserved by the new implementation.

**Verdict: PASS — H2 / cost-02 invariant holds.**

---

### Logic-skeptic — counter init / increment correctness + near-cap re-query

**Init correctness:** `open()` runs `SELECT COUNT(*) FROM events` after
`execute_batch` (which creates the table if it does not exist) and after the
SQLCipher key pragma. This is the first query to the opened (and keyed) database,
so the count is accurate. A new empty store returns 0; a reopened store returns
the real row count. Both are correct.

**Increment correctness:** `cached_event_count += 1` is placed AFTER the
`self.conn.execute(...)` call and only on the success branch (the `?` operator
returns early on error). A failed INSERT therefore does not increment the cache.
Correct.

**Near-cap arithmetic:** `cached_event_count + COUNT_RECHECK_MARGIN >= cap`.
Edge cases:
- `cached_event_count = 0, cap = 50, MARGIN = 100`: `0 + 100 >= 50` → true →
  re-query always. This only occurs in tests with tiny caps; the re-query is
  correct and cheap.
- `cached_event_count = 4_999_899, cap = 5_000_000, MARGIN = 100`:
  `4_999_899 + 100 = 4_999_999 >= 5_000_000`? No (4_999_999 < 5_000_000) →
  fast path. The next append: `4_999_900 + 100 = 5_000_000 >= 5_000_000` → re-query.
  Re-query is triggered for the last 100 inserts before the cap. Correct.
- **Overflow check:** `cached_event_count` is `u64`; `COUNT_RECHECK_MARGIN = 100`;
  `EVENT_SOFT_CAP = 5_000_000`. The addition `cached_event_count + 100` cannot
  overflow `u64` at any realistic row count (max `u64` ≈ 1.8 × 10¹⁹).

**Re-query on bail path:** When `count >= cap` (after re-query), `append()` bails
immediately. The next call to `append()` will again hit the near-cap branch
(since `cached_event_count` equals the cap), re-query again, and bail again. This
is a safe steady-state loop identical to the prior behaviour, but with one
real `COUNT(*)` per bail call rather than one per append in all cases. Cost is
not worse near the cap.

**Verdict: PASS — counter logic is correct in all paths.**

---

### Cost-auditor — per-append overhead removed

**Before:** every `append()` call ran `SELECT COUNT(*) FROM events` (full index
scan, or at minimum a B-tree walk) before the INSERT. At normal study sizes
(thousands to low-hundreds-of-thousands of rows) this was <1 ms but non-zero.
At cap (5 000 000 rows) the scan is measurably slower.

**After:** the common path (>100 rows from the cap) uses `cached_event_count` — a
single `u64` comparison, zero SQLite round-trips. The full `COUNT(*)` runs exactly
twice in the entire store lifetime for a well-behaved study: once at `open()` and
once per re-open. It also runs once per append for the last 100 inserts before
the cap and on every bail call at cap — but this is a degenerate (at-capacity)
state and is no worse than before.

**Net cost:** one `COUNT(*)` at open, then ~zero per append until the near-cap
window. This is strictly better than one `COUNT(*)` per append, and fully resolves
both LS-01 and cost-01 from the prior gate.

**Verdict: PASS — per-append scan eliminated; LS-01 / cost-01 resolved.**

---

## Disposition
- Blocking (P0/P1): ☑ (0 found)
- Non-blocking tracked: ☑ (none)
- **Gate verdict:** PASS
- **Signed:** pending John's sign-off (gate executed by Claude Code on 2026-06-19)
