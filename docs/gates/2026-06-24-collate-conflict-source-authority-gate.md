# Whole-Branch Adversarial Gate — `feat/company-brain-c1-c2`

**Branch:** `feat/company-brain-c1-c2` (worktree `C:\nib-c1c2`)
**Scope:** C1 collate pass + C2 conflict-resolution + learned source-authority
**Reviewer:** final-gate adversarial review
**Date:** 2026-06-24

**Verdict: CHANGES-REQUIRED**

Counts: **Critical 1, Important 2, Minor 4.**

The SQL surface (RPCs, RLS, grants, advisory locks, audit, weight math) is solid and well-tested by the live-Postgres `tests/rls` harness. The defect is entirely in the **TypeScript collate hot path** (`collate.ts`), which never reaches the DB correctly and — worse — reads cross-account data under a service-role client. The unit tests pass only because the mock ignores query filters, so they give false confidence.

---

## 1. Red-team / Security & RLS

### [CRITICAL] `collateAccount` reads every account's data under service-role (no `account_id` filter) — cross-account bleed
**File:** `apps/web/lib/brain/collate.ts:138, 158-159, 169-170, 281-282`

`svc` is the **service-role** client (`route.ts:526` → `serviceClient()`), for which **RLS does not apply**. Every read in the collate pass is an unscoped table scan:

```ts
svc.from('source_authority')   // line 138  — ALL accounts
svc.from('proposals')          // line 159  — ALL accounts
svc.from('grove_memory')       // line 170  — ALL accounts
svc.from('field_meta')         // line 282  — ALL accounts
```

None call `.eq('account_id', accountId)` (verified: the file contains zero `.eq(`, zero `account_id`). Consequences when collating account A:

- Conflict detection runs over **account B's proposals**, then `flag_field_conflict(p_account = A, …)` writes a flag onto **account A** referencing **B's source ids** — a genuine cross-tenant data-integrity and privacy breach (B's source ids/values surface in A's Memory UI and A's morning-brief notification body).
- Dedup `svc.from('proposals').update({status:'superseded'}).in('id', dupIds)` (line 265) — `dupIds` are drawn from the cross-account list, so collating one account can **supersede another account's proposals**.
- Stale count aggregates `field_meta` across all accounts.

This is the single must-fix blocker. **Fix:** scope every read to the account and join the source kind, e.g.
```ts
svc.from('proposals').select('id,field_key,proposed_value,source_id,status,created_at,sources(kind)').eq('account_id', accountId)
svc.from('source_authority').select('source_kind,weight').eq('account_id', accountId)
svc.from('grove_memory').select('sections,hard_rules,notes').eq('account_id', accountId).maybeSingle()
svc.from('field_meta').select('field_key,last_reviewed_at').eq('account_id', accountId)
```
Add a live-DB (or at least a filter-asserting mock) test that fails when the `account_id` filter is missing.

### [OK] `resolve_field_flag` auth + membership is correctly flag-derived
`resolve_field_flag` (migration 114-148) loads the flag `for update`, derives `v_flag.account_id` from the row (never client-passed), checks `auth.uid() is not null` then `private.is_account_member(v_flag.account_id)` **before any write**, then guards `status='needs_review'`. A member of account A cannot resolve account B's flag (RLS-test `not a member` case passes). Account is not spoofable. Correct.

### [OK — within trust model] arbitrary `p_chosen_value`
A member can write any text into the curated field via the resolve path. This matches the existing trust model — the same member can already call `save_grove_memory` with arbitrary values, and "the user's pick IS the approval" is the design (D11). Not constrained to a competing source's value, by design. Acceptable; noted for the record.

### [OK] Service-role-only RPCs + member-read table
`flag_field_conflict` and `ensure_source_authority`: `revoke … from public, anon, authenticated` + `grant … to service_role` (migration 46-47, 104-105). RLS test asserts `authenticated caller cannot execute flag_field_conflict` → `permission denied`. `source_authority`: RLS enabled, member-read policy via `is_account_member`, writes revoked from anon/authenticated. Correct.

### [OK] Advisory lock + search_path + grove_memory shape
`resolve_field_flag` sets `search_path=''`, takes `pg_advisory_xact_lock(hashtext('grove_memory:'||account))` (same key as `save_grove_memory`/`decide_memory_proposal`), bumps `version`, and the notes/hard_rules/sections dispatch is a faithful copy of `decide_memory_proposal`'s approve branch (replace semantics instead of append — correct for a conflict pick). No shape corruption.

### [OK] Collate cron auth + service client + no curated write
`route.ts` gates on `isAuthorizedCronRequest` (401 else; fail-closed, constant-time). `collateAccount` only calls `flag_field_conflict` / `insert_system_notification` / proposals-status update — it never writes the curated `grove_memory` layer. Correct per "all collate output is proposals/flags/notifications."

### [OK] Notification authoring bounded
Brief body is assembled from integer counts; flag body = `p_detail` (capped ≤300 in conflict-detect, and `field_flags.detail` CHECK ≤1000 + `notifications.body` CHECK ≤2000). No unbounded text. (The cross-account leak of *which* values appear in the body is covered by the Critical above, not a separate notification bug.)

---

## 2. Claims-auditor

### [IMPORTANT] Conflict detection is dead in production — missing `sources(kind)` join
**File:** `apps/web/lib/brain/collate.ts:159, 185-186`

`ProposalRow` declares `sources?: { kind: string }`, and step 3 does `const kind = p.sources?.kind; if (!kind) continue;`. But the query (`svc.from('proposals')`) selects no columns and **never joins `sources`**, so `p.sources` is always `undefined` → every proposal is skipped → **`detectFieldConflicts` always receives an empty field set → zero conflicts ever flagged.** The headline C2 feature does nothing at runtime. The mock supplies `sources.kind` inline, so all 16 tests pass green over a code path that cannot work against the real DB. Fix = add `.select('…, sources(kind)')` (and the account filter, per the Critical).

### [OK] RPC arg names match exactly (PostgREST by-name)
- `ensure_source_authority({ p_account })` ✓ (SQL param `p_account`)
- `flag_field_conflict({ p_account, p_field_key, p_competing_source_ids, p_detail, p_stakes, p_suggested_source_id })` ✓ (SQL 60-66)
- `insert_system_notification({ p_account, p_kind, p_source_id, p_title, p_body, p_payload, p_stakes })` ✓ (7-arg, migration 20260623100000)
- `resolve_field_flag({ p_flag_id, p_chosen_source_id, p_chosen_value })` ✓ (actions.ts + SQL 114-118); bidirectional arg-name test present.

### [OK] Idempotency / arity handling
`field_flags.suggested_source_id` added via `add column if not exists` (idempotent). `flag_field_conflict` is net-new (no prior cross-migration definition); the `drop function if exists …(5-arg)` + create-6-arg + re-grant within the same file means no phantom overload survives, and grants are re-applied to the 6-arg signature. Correct. (Editing the migration in place is safe because it has not yet been applied to any of the 3 DBs.)

### [OK] Keeper gained no write/resolve capability
`pending-items.ts` step 4 is a read-only, member-scoped (RLS), fail-safe `field_flags` query. `prompt.ts` only emits a text line pointing to `/app/memory`; comment + copy explicitly state the Keeper has no hands. No tool/IPC surface added.

### [OK] Source-authority math bounded, no double-count
Chosen kind `least(100, weight+5)`; competing kinds `greatest(0, weight-5)`; chosen kind pushed into `v_seen_kinds` first and competing loop skips the chosen source and de-dupes by kind via `v_seen_kinds` — two competing sources sharing a kind are decremented once. RLS test covers cap=100/floor=0 boundaries. Correct.

### [Minor] No tautological tests found
The `tests/rls` suites assert real post-mutation DB state (values, version, history `change_source`, weight deltas, cross-member rejection). The collate/conflict-detect unit tests are real assertions — their weakness is the **mock fidelity** (above), not tautology.

---

## 3. Logic-skeptic

### [IMPORTANT] `resolve_field_flag` does not validate `p_chosen_source_id` ∈ competing set, and `field_evidence` insert is unguarded
**File:** migration `:219-221` (and absence of a membership check on the chosen source)

Two coupled issues:
1. There is **no check** that `p_chosen_source_id` is one of `v_flag.competing_source_ids`. A member can resolve a flag by passing any arbitrary (or null) source id. The plan (Task 3) and the logic-skeptic prompt both flag this as "should that be rejected?" — it currently is not.
2. `insert into field_evidence (…, source_id, …) values (…, p_chosen_source_id, …)` is **unguarded** for null, unlike `decide_memory_proposal` which wraps the evidence insert in `if p.source_id is not null`. `field_evidence.source_id` is `NOT NULL REFERENCES sources(id)`. If the UI ever sends a null/foreign `p_chosen_source_id`, the FK/NOT-NULL violation aborts the **entire resolve transaction** after the user clicked "This is right" — a confusing hard failure rather than a clean validation error.

The current UI always sends a real competing source id, so this is latent, but it's a real robustness/authorization gap on a member-callable write RPC. **Fix:** after loading the flag, `if p_chosen_source_id is null or not (p_chosen_source_id = any(v_flag.competing_source_ids)) then raise exception 'chosen source is not a candidate for this flag'; end if;` (then the evidence insert is safe).

### [Minor] `loadOpenConflicts` proposal-value lookup can misfire after dedup
**File:** `apps/web/app/app/memory/page.tsx:233-247`

Candidate values are pulled from `proposals` where `status='pending'`. The collate pass supersedes duplicate pendings (→ `superseded`) and `decide_memory_proposal` flips status on approve/reject. A competing source whose proposal is no longer `pending` renders with an empty value (`''` → "no value") in the conflict picker even though the flag still lists it. Cosmetic (the pick still works via `p_chosen_value=''`), but the surfaced value can be misleadingly blank. Consider widening the status filter or storing candidate values on the flag.

### [OK] Other edge cases
- One-open-flag-per-field unique index + `flag_field_conflict` upsert (update-open-else-insert) handles concurrent flagging deterministically.
- Dedup keeps the earliest by `created_at` (stable survivor).
- Resolving an already-resolved/dismissed flag → `conflict already resolved` (status guard + RLS test).
- Conflict-detect normalization (trim/lowercase/collapse-ws), substring suppression, and currentValue-cannot-trigger-alone are correct and well-tested (33 tests).
- Morning-brief idempotency: `source_id='collate:'||date` + notifications `unique(account,kind,source_id)` + `on conflict do nothing` → one brief per account per day.
- FK/deleted-source: `sources` lookups in resolve use `select … into` (null → skipped for the weight nudge); `competing_source_ids` is a bare `uuid[]` (no FK), so a deleted source id is tolerated in the array.

---

## 4. Cost

### [OK / contingent] Bounded batch, deterministic detection
Cron caps at `BATCH_SIZE=200` accounts, `maxDuration=60`. Conflict detection is pure/deterministic with **no model calls** in the hot path (confirmed). Morning brief is **one** notification per account per run (not per field). Per account the query count is small and constant.

### [Minor] Cross-account scans amplify cost (consequence of the Critical)
Because the reads are unscoped (Critical #1), each of the 200 per-account iterations currently scans the **entire** `proposals` / `grove_memory` / `field_meta` / `source_authority` tables — i.e. ~200× full-table reads per nightly run instead of 200 indexed point-lookups. Fixing the Critical (`account_id` filters, which hit existing indexes like `proposals_queue_idx`) resolves the cost issue too.

---

## Must-fix list (Critical / Important)

1. **[CRITICAL]** `collate.ts` — scope every read (`source_authority`, `proposals`, `grove_memory`, `field_meta`) to `.eq('account_id', accountId)` (+ `.maybeSingle()` on grove_memory). Under service-role there is no RLS; the current code reads and acts on all tenants' data. Add a test that fails without the filter.
2. **[IMPORTANT]** `collate.ts` — add the `sources(kind)` join to the proposals select; without it `p.sources?.kind` is always undefined and **no conflict is ever detected in production**.
3. **[IMPORTANT]** `resolve_field_flag` — validate `p_chosen_source_id` is non-null and a member of `v_flag.competing_source_ids` before writing; this also makes the unguarded `field_evidence` insert safe.

## Minor (non-blocking)
- `create table public.source_authority` is not `if not exists` (siblings are) — re-apply would error; harmless under once-only tracker application.
- `loadOpenConflicts` shows blank candidate values for non-`pending` competing proposals.
- Collate unit-test mock ignores query filters/joins (root cause of why #1 and #2 shipped green) — harden the mock or add a live-DB collate test.
- `resolveFieldFlag` UI is fire-and-forget (no `router.refresh()`/`revalidatePath`); banner clears only on reload (self-documented TODO).
