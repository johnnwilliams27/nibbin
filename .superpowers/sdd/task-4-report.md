# Task 4 Implementation Report: `decide_memory_proposal`

## Status
DONE — all 12 tests pass, commit created.

## Files Modified
- `supabase/migrations/20260622140000_company_brain_foundation.sql` — appended `decide_memory_proposal` DDL (after Tasks 1–3 DDL; Tasks 1–3 DDL untouched)
- `tests/rls/company-brain-foundation.test.ts` — appended Task 4 `describe` block (Tasks 1–3 tests untouched)
- `.superpowers/sdd/task-4-report.md` — this report

## Audit Log Verification

Checked `supabase/migrations/20260610170000_m1_account_hierarchy_and_credit_ledger.sql`:

```sql
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts (id) on delete restrict,
  actor text not null check (actor in ('user', 'nibbin', 'system', 'staff')),
  actor_id text not null,
  action text not null,       -- ← NO CHECK constraint on action
  subject text,
  meta jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
```

**Finding:** `action` is `text not null` with NO CHECK constraint. No constraint extension needed. The INSERT in `decide_memory_proposal` uses `action='memory.ratified'`, which is accepted as-is.

No additional migrations to any other audit_log-related files were needed. No CHECK constraint was dropped or re-added.

## Implementation Notes

- `decide_memory_proposal(p_proposal_id uuid, p_decision text) returns void` — authenticated member only
- `security definer set search_path=''` — follows project convention
- `revoke execute ... from public, anon, service_role` + `grant execute ... to authenticated` — enforced
- Advisory lock on `'grove_memory:' || account_id` for concurrency safety (mirrors `save_grove_memory`)
- On approve: writes curated field (sections/hard_rules/notes dispatch), appends history (`change_source='proposal'` or `'conflict'`), upserts `field_meta`, links `field_evidence` (if `source_id` non-null), logs `audit_log` (`action='memory.ratified'`), resolves `review_item` notification, marks proposal `approved`
- On reject: logs audit, resolves notification, marks proposal `rejected`, writes NOTHING to grove_memory or history
- Non-member guard: `private.is_account_member(p.account_id)` checked after loading the proposal — a non-member gets "not a member of this account"
- "proposal not found" if proposal doesn't exist (also covers cross-account since they can't load each other's proposals via the RPC's direct select, which bypasses RLS but still correctly checks membership)

## Test Results

```
Tests  12 passed (12)
```

- Task 1 (F1 schema + RLS): 4 tests ✓
- Task 2 (save_grove_memory history): 2 tests ✓
- Task 3 (propose_memory_change + review_item): 3 tests ✓
- Task 4 (decide_memory_proposal): 3 tests ✓

## No Concerns

No deviations from the plan. The audit_log schema matched the plan's assumption exactly (`actor`, `actor_id`, `action`, `subject`, `meta` columns; no CHECK on `action`).
