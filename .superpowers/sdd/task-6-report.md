# Task 6 Report — P2 End-to-End Integration Tests

**Branch:** `feature/company-brain-docs-ingest`
**File extended:** `tests/rls/company-brain-p2.test.ts`
**Date:** 2026-06-23

---

## Status

COMPLETE. All 26 tests pass in `company-brain-p2.test.ts`; all 15 tests pass in `company-brain-foundation.test.ts` (regression).

---

## What was implemented

Added a new `describe` block `'P2 — end-to-end doc_extract proposal → approve'` to `tests/rls/company-brain-p2.test.ts` with 5 integration tests that exercise the REAL `propose_memory_change` / `decide_memory_proposal` RPCs against live Postgres (no DB mocks). The model and Storage are absent from this layer (those are unit-tested in `doc-extract.test.ts`).

### Tests

1. **`doc_extract proposal → approve → curated value written + field_evidence linked + audit logged + notification resolved`**
   - Service inserts a `sources` row (`kind='document'`, `redaction_status='clean'`), calls the real `propose_memory_change($acct, 'pricing', 'replace', '$250/hr', rationale, $srcId, 'doc_extract')`.
   - Asserts proposal `origin='doc_extract'`, `status='pending'`, `source_id=srcId`.
   - Member calls `decide_memory_proposal($pid, 'approved')`.
   - Asserts: `grove_memory.sections->>'pricing' = '$250/hr'`; `field_evidence` row exists with `relationship='supports'` and `source_id=srcId`; `grove_memory_history` has `change_source='proposal'` and `proposal_id=pid`; `audit_log` has `action='memory.ratified'` with `origin='doc_extract'` in meta; proposal `status='approved'`; `notifications.read_at` is not null (resolved).

2. **`doc_extract proposal → reject → curated value unchanged`**
   - Same setup, member rejects; asserts `grove_memory` has no `turnaround` key (null); `field_evidence` count = 0; proposal `status='rejected'`.

3. **`multiple field proposals from one source: approve all → field_evidence has 3 rows for the same source`**
   - One `sources` row (`kind='document'`) backs 3 proposals for `facts`, `target_market`, `packages`.
   - After approving all three: all curated values are written; `field_evidence` has exactly 3 rows all pointing to the same `srcId` with `relationship='supports'`.

4. **`quarantined source: propose_memory_change raises; zero proposals created end-to-end`**
   - Service inserts a source with `redaction_status='quarantined'`; calling `propose_memory_change` with that `source_id` raises an exception matching `/quarantined/i`.
   - Asserts `proposals` count = 0 for that source; `field_evidence` count = 0. Proves the DB guard enforces the "quarantined → zero proposals" invariant end-to-end.

5. **`regression: 'manual' origin proposals still work after P2 migration changes`**
   - Classic F2 path: `propose_memory_change` with `origin='manual'`, no `source_id`; approve; curated value written; no `field_evidence` row (expected — no source to link); `audit_log` has `memory.ratified`.

---

## Key design decisions

- **Real RPCs, no mocks.** Both `propose_memory_change` and `decide_memory_proposal` are called verbatim. The tests prove the document path is indistinguishable from the manual F2 path at the DB layer, just with `origin='doc_extract'` and a `source_id` set.
- **Derived-not-raw.** The curated value is the extracted fact (`'$250/hr'`); the original document is retained as the `sources` row. The `field_evidence` link connects the two without embedding raw content into `grove_memory`.
- **Quarantine is a complete end-to-end gate.** Test 4 proves that a quarantined source cannot back any proposal — not just in the app layer but at the DB RPC level. This closes the "quarantined extraction yields ZERO proposals" requirement.
- **Notification lifecycle.** Test 1 verifies that `read_at` is set after `decide_memory_proposal` — the review_item lifecycle is complete.

---

## Bug fixed during implementation

The `sections->>${JSON.stringify(f.key)}` SQL expression produced double-quoted identifiers (e.g., `sections->>"facts"`) which PostgreSQL interprets as column references, not string literals. Fixed by using parameterized query: `sections->>$2` with the field key as a parameter.

---

## Concerns

None blocking. One observation for the record:

- **Field_evidence upsert is idempotent (`ON CONFLICT DO NOTHING`).** If the same document source is approved for the same field twice (e.g., the user retracts and re-approves), only one `field_evidence` row is kept. This is correct behavior per the unique index on `(account_id, field_key, source_id)`.

---

## Test command

```
npx vitest run tests/rls/company-brain-p2.test.ts
```

Result: **26 passed** (21 from Tasks 1–5 + 5 new from Task 6).

Foundation regression:
```
npx vitest run tests/rls/company-brain-foundation.test.ts
```

Result: **15 passed** (no regressions).
