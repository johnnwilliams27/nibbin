# C1 Collate + C2 Conflict Resolution & Learned Source-Authority — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Add the periodic collate pass (C1) and conflict-resolution + learned per-account source-authority (C2) on top of the shipped Company Brain (F1/F2 + P2/P3/P5/P6).

## Design (decided with John 2026-06-22 + this session)
- **Conflicts are surfaced, never auto-resolved** (D10). A conflict is a **persistent `field_flags` row** on the field (survives closing chat), with competing sources attached.
- **The user's pick IS the approval** (Trust Ledger): resolving a conflict writes the chosen value via the existing approve path, logs `audit_log`, and **metabolizes into source-authority** (D11).
- **Source-authority is a learned per-(account, source_kind) weight** (decided: per-kind, not per-source), seeded by config (document/manual high, connector mid, observation lower) and nudged on each resolution. Higher-authority source becomes the *suggested* pick; the human still ratifies.
- **Surfacing tiers**: high-stakes flags (pricing/policies/hard_rules) push proactively (P6 notification + red-bubble); trivial flags batch into the C1 **morning brief**. The Grovekeeper already has read-access to the attention queue (P6) — field_flags join it.
- **All collate/distill output is proposals or flags — never a direct curated write.**

Reuses: `field_flags` (Foundation), `proposals`/`propose_memory_change`/`decide_memory_proposal` apply logic, `insert_system_notification` (7-arg, stakes), `loadPendingItems` (P6), `sources.kind`/`source_tier`, `audit_log`, the `cron/plan-run-reaper` route pattern + `isAuthorizedCronRequest`.

**Tech Stack:** Next.js 15 (Node cron route + RSC), Supabase/Postgres 17, vitest + `tests/rls` live-Postgres harness.

## Global Constraints
- Every new RPC: `security definer`, `set search_path=''`, auth/member or service-role posture as noted, advisory lock where it mutates grove_memory, grant/revoke matching siblings. **No direct curated write without a human approval event** (resolve_field_flag is that event).
- PostgREST resolves RPC args by NAME — action/worker tests assert exact arg-name shape (the regression class that bit this repo).
- Conflict detection is **deterministic/heuristic** for v1 (no model call in the hot path) — material disagreement = ≥2 distinct non-empty normalized values for one field from ≥2 distinct sources. (LLM contradiction-judging is a documented follow-up.)
- Migration applies to all 3 DBs at merge; note prod's tracker drift (check real schema first).
- Cron routes reuse the existing cron auth secret; register in `vercel.json`.

---

### Task 1: Migration — `source_authority` table + seed + RLS
**Files:** Create `supabase/migrations/20260624120000_collate_conflict_source_authority.sql`; Test: `tests/rls/source-authority.schema.test.ts`.
**Interfaces produced:**
```sql
create table public.source_authority (
  account_id  uuid not null references public.accounts(id) on delete cascade,
  source_kind text not null check (source_kind in ('document','connector_artifact','observation','manual')),
  weight      numeric not null default 50 check (weight >= 0 and weight <= 100),
  updated_at  timestamptz not null default now(),
  primary key (account_id, source_kind)
);
-- seed helper: ensure_source_authority(account) upserts the 4 kinds with config defaults
--   document=70, manual=65, connector_artifact=50, observation=40
```
RLS: enable; member-read policy via `private.is_account_member(account_id)`; revoke writes from anon/authenticated (service-role + the resolve RPC only).
- [ ] Failing schema test (table + columns + CHECK + RLS enabled). → FAIL → migration → PASS → commit. (Append the Task 2/3 RPCs to this same migration in their tasks.)

### Task 2: `flag_field_conflict` RPC (service-role) + `ensure_source_authority`
**Files:** append to the migration; Test: `tests/rls/flag-field-conflict.rpc.test.ts`.
**Interfaces:**
- `ensure_source_authority(p_account uuid) returns void` — upserts the 4 seeded kind rows (on conflict do nothing).
- `flag_field_conflict(p_account uuid, p_field_key text, p_competing_source_ids uuid[], p_detail text, p_stakes text default 'normal') returns uuid` — service-role. Idempotent against the `field_flags_one_open_idx` (one open flag per field): if an open flag exists for (account, field_key), update its competing_source_ids/detail; else insert `needs_review`. Then `insert_system_notification(p_account,'review_item',flag_id::text,'A conflict needs your review', p_detail, jsonb_build_object('field_flag_id',flag_id,'field_key',p_field_key,'kind','conflict'), p_stakes)`. Returns the flag id. Grant execute to service_role only.
- [ ] Failing RLS tests: a new conflict inserts a needs_review flag + a notification; a second call for the same open field updates (not duplicates); high-stakes passes p_stakes='high'; non-service caller rejected. → FAIL → implement → PASS → commit.

### Task 3: `resolve_field_flag` RPC (member) — write value + resolve + audit + learn
**Files:** append to the migration; Test: `tests/rls/resolve-field-flag.rpc.test.ts`.
**Interfaces:**
`resolve_field_flag(p_flag_id uuid, p_chosen_source_id uuid, p_chosen_value text) returns void` — member-only. In one tx, with `pg_advisory_xact_lock(hashtext('grove_memory:'||account))`:
1. Load the flag `for update`; verify member; require status='needs_review'.
2. Write `p_chosen_value` to the curated field (reuse the same dispatch as `decide_memory_proposal`'s approve branch — notes/hard_rules/sections, version bump, grove_memory_history with change_source='conflict', field_meta last_reviewed_at, field_evidence supports for the chosen source).
3. Mark flag `resolved` (resolved_at=now(), resolution = the chosen source id/value summary).
4. `audit_log` (action='memory.ratified', meta includes field_flag_id, chosen_source_id, decision='conflict_resolved').
5. **Learn**: `ensure_source_authority(account)`; bump the chosen source's KIND weight by +`AUTH_DELTA` (5, capped 100); for each OTHER competing source's KIND, weight -`AUTH_DELTA` (floored 0). Look up each competing source's kind from `public.sources`.
6. Resolve the related `review_item` notification (read_at=now()).
Member grant; revoke from anon/service_role.
- [ ] Failing RLS tests: resolving writes the chosen value to grove_memory + bumps version + history(change_source='conflict'); flag→resolved; audit_log row; source_authority weight for chosen kind ↑ and the rejected competing kind ↓ (bounded 0..100); non-member rejected; already-resolved flag raises. Assert exact arg names. → FAIL → implement → PASS → commit.

### Task 4: conflict-detection pure core
**Files:** Create `apps/web/lib/brain/conflict-detect.ts`; Test: `conflict-detect.test.ts`.
**Interfaces:** `detectFieldConflicts(input): FieldConflict[]` where input is per-field: `{ fieldKey, currentValue, contributions: {sourceId, sourceKind, value}[] }[]` and `authority: Record<sourceKind, number>`. Returns conflicts where ≥2 distinct non-empty NORMALIZED values come from ≥2 distinct sources (normalize = trim+lowercase+collapse-ws; ignore substring-of relationships to avoid near-dup noise). Each `FieldConflict` = `{ fieldKey, competingSourceIds, suggestedSourceId (highest authority weight), detail (a short human summary of the competing values), stakes ('high' if fieldKey in {pricing,policies,hard_rules} else 'normal') }`.
- [ ] Failing tests: two sources, materially different values → one conflict, suggested = higher-authority kind, stakes by field; identical/near-dup values → no conflict; single source → no conflict; substring values → no conflict; pricing/policies/hard_rules → stakes='high'. → FAIL → implement → PASS → commit.

### Task 5: collate pass logic (dedup + stale + contradictions + morning brief)
**Files:** Create `apps/web/lib/brain/collate.ts`; Test: `collate.test.ts`.
**Interfaces:** `collateAccount(svc, accountId): Promise<CollateResult>` —
1. Gather per-field contributions: the current grove_memory sections + each field's proposals (`proposals` rows: source_id, proposed_value, field_key) joined to `sources.kind`. Load `source_authority` (ensure seeded).
2. **Contradictions**: run `detectFieldConflicts`; for each → `flag_field_conflict(...)` (idempotent).
3. **Dedup**: among PENDING proposals for the same (field_key, normalized value), keep the earliest, mark the rest dismissed (a `dismiss_proposal` service path or set status; keep minimal — dedup pending duplicates only).
4. **Stale**: fields whose `field_meta.last_reviewed_at` < now()-`STALE_DAYS`(60) → count for the brief (no write).
5. **Morning brief**: ONE `insert_system_notification(account,'review_item','collate:'||date,'Your morning brief', <summary: N conflicts, N stale, N dupes>, jsonb..., 'normal')` per run when there's anything to report; skip when empty. Returns counts. Fail-safe per step (one field's error doesn't abort the account).
- [ ] Failing tests (mock svc): contradictions call flag_field_conflict; duplicate pending proposals are deduped; stale fields counted; a brief notification is emitted with the right counts; empty account emits nothing. → FAIL → implement → PASS → commit.

### Task 6: `cron/collate-pass` route
**Files:** Create `apps/web/app/api/cron/collate-pass/route.ts`; register in `vercel.json`; Test: route test.
**Interfaces:** mirror `plan-run-reaper`: GET, `isAuthorizedCronRequest` (401 else), iterate a bounded batch of active accounts (cap, e.g. 200 by recent activity), call `collateAccount` per account (fail-safe), log totals. Daily schedule in vercel.json.
- [ ] Failing route test (mock service + cron-auth): 401 without auth; with auth, calls collateAccount per account + returns counts. → FAIL → implement → PASS → commit.

### Task 7: Grovekeeper + notification surfacing of field_flags
**Files:** Modify `apps/web/lib/grove/pending-items.ts` (P6 `loadPendingItems`) to ALSO load open `field_flags` as a pending-item category; Modify `packages/keeper/src/prompt.ts`/types if needed so `buildKeeperContext` can mention conflicts; Test: extend pending-items + keeper tests.
**Interfaces:** `loadPendingItems` returns conflicts alongside proposals/runs (read-only, fail-safe → empty on error, C10 preserved). The keeper context can say "N things waiting, including a pricing conflict" + deep-link to the Memory field. Do NOT give the keeper any write/resolve capability (no hands) — resolution happens via the Memory UI (Task 8).
- [ ] Failing tests: loadPendingItems includes open field_flags (member-scoped, fail-safe); buildKeeperContext surfaces a conflict line when present. → FAIL → implement → PASS → commit.

### Task 8: Memory field conflict flag + resolve UI
**Files:** Create `apps/web/app/app/memory/ConflictFlag.tsx` + a `resolveFieldFlag` server action in `actions.ts`; Modify `FieldBlock.tsx`/`MemoryClient`/`page.tsx` to load open field_flags for the account and render a "Needs your review" flag on the affected field with the competing sources + a pick control; Test: reducer/render tests + action arg-name test.
**Interfaces:** `resolveFieldFlag(formData)` server action → `supabase.rpc('resolve_field_flag',{ p_flag_id, p_chosen_source_id, p_chosen_value })` (EXACT keys). The ConflictFlag shows each competing source (label + its value), highlights the suggested one (authority), and on pick calls the action. page.tsx loads open field_flags (member-scoped, graceful-empty) and passes them to MemoryClient → FieldBlock.
- [ ] Failing tests: action calls resolve_field_flag with exact arg-name shape + inline result; render test shows the flag + competing sources + suggested highlight; resolving hides the flag. Render via `renderToStaticMarkup`. → FAIL → implement → PASS → commit.

### Task 9: full-suite green
- [ ] `npm run lint`, `npm run typecheck`, brain/grove/memory/cron/keeper + tests/rls suites. Known-acceptable: `.next/types` stale + missing-optional-dep. No `console.error(\`…${x}\`,y)`. Verify each red vs `git diff origin/main...HEAD`. Commit `chore: green (collate + conflict + source-authority)`.

## Merge notes
- Migration `20260624120000` → 3 DBs (check real schema first — prod tracker drift). `vercel.json` cron entry + existing cron secret. Adversarial gate required (sensitive: new RPCs write curated memory + a cron + member resolve path).
