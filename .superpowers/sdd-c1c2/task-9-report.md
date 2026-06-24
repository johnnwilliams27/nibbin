# Task 9 — Full-suite green (C1 collate + C2 conflict + source-authority)

Branch: `feat/company-brain-c1-c2` (worktree `C:\nib-c1c2`)
Commit: `1829be93` — `chore: green (collate + conflict + source-authority)`

## Commands run + results

| Command | Result |
|---|---|
| `npm run lint` | PASS (0 problems after fix; 3 errors before) |
| `npm run typecheck` | PASS (exit 0, zero errors — incl. none of the known-acceptable ones surfaced this run) |
| `npx vitest run apps/web/lib/brain apps/web/lib/grove apps/web/app/app/memory apps/web/app/app/grove apps/web/app/api/cron packages/keeper` | PASS — 57 files, **1063 passed** |
| `npx vitest run tests/rls` | PASS — 39 files, **383 passed / 1 skipped (384)** |

## Fixes applied (all in this branch's C1/C2 test files)

`npm run lint` reported 3 errors, all in Task 4/5 test files (confirmed in
`git diff origin/main...HEAD`):

- `apps/web/lib/brain/collate.test.ts` — unused `beforeEach` + unused `makeSvc`
  factory (dead; superseded by `buildSvc`) → removed the dead `makeSvc` block and
  its now-unused `vi`/`beforeEach` imports.
- `apps/web/lib/brain/conflict-detect.test.ts` — unused `FieldConflict` type import → removed.

Test-only deletions; no production logic touched. Re-ran lint → clean.

## semgrep `unsafe-formatstring` guard

Grepped all 6 C1/C2 surface files (collate.ts, conflict-detect.ts, cron route,
pending-items.ts, actions.ts, ConflictFlag.tsx) for
`console.error|warn(\`…${x}\`, y)`: **none found**. The `console.error` calls in
collate.ts and pending-items.ts pass the second arg as a plain comma-separated
value (`err.message`), not a template literal — safe.

## Invariant confirmations

**Migration `20260624120000_collate_conflict_source_authority.sql` self-consistent + idempotent**
- `source_authority` table (lines 10–16) + 3 RPCs: `ensure_source_authority` (34–45),
  `flag_field_conflict` 6-arg final signature (60–66), `resolve_field_flag` (114–118).
- `field_flags.suggested_source_id` alter is `add column if not exists` (lines 7–8) — idempotent on the Foundation table.
- Old 5-arg `flag_field_conflict` overload explicitly dropped (line 58) before recreating the 6-arg form — no phantom stub.

**Grants / RLS posture**
- `resolve_field_flag`: granted `authenticated` only; revoked from public/anon/service_role (303–304). ✓ member-only.
- `flag_field_conflict` + `ensure_source_authority`: revoked from public/anon/authenticated, granted `service_role` only (46–47, 104–105). ✓
- `source_authority`: RLS enabled; member-read SELECT policy via `private.is_account_member`; INSERT/UPDATE/DELETE revoked from authenticated, all revoked from anon (19–26). ✓ member-read / no client writes.

**Grovekeeper gained NO write/resolve capability (still no-hands)**
- `packages/keeper/src/` has zero `.rpc(`/insert/update/`resolve_field_flag`/`flag_field_conflict` references — keeper has no DB handle at all.
- `apps/web/lib/grove/pending-items.ts` (Task 7) only does a read-only `.from('field_flags').select(...)` filtered to `needs_review`, fail-safe → empty conflicts on error (C10 preserved). No insert/update/rpc.

**All extraction/collate output remains proposals/flags (no direct curated write except human-approval resolve path)**
- `collate.ts` writes only via `flag_field_conflict` RPC (flags), `insert_system_notification` (morning brief), and a proposals dedup `update({status:'superseded'})` scoped to the `proposals` table. grove_memory is read-only in collate (line 170 SELECT).
- The only path that writes the curated grove_memory field is `resolve_field_flag`, which is the human-approval event (member-only, audit-logged `memory.ratified`).
- `actions.ts` `resolveFieldFlag` calls `supabase.rpc('resolve_field_flag', { p_flag_id, p_chosen_source_id, p_chosen_value })` — exact arg names matching the migration.

## Remaining red

None. All four commands green.

## Known-acceptable items (per plan)

The plan flagged `.next/types` stale-route errors and missing-optional-dep
typecheck errors (`@vercel/analytics`, `@sparticuz/chromium`, `@nangohq/node`) as
pre-existing/acceptable. This run's `npm run typecheck` exited 0 with **zero**
errors of any kind — none of the known-acceptable errors surfaced (likely a clean
`.next` cache / installed deps in this worktree), so nothing needed to be waived.

## Skipped RLS test (1)

Not a regression. The repo-wide pattern is `describe.skipIf(!dbAvailable)`; the DB
was available (383 passed). No `it.skip`/`test.skip` exists in any C1/C2 RLS file
(`source-authority`, `flag-field-conflict`, `resolve-field-flag`). The single skip
is a pre-existing conditional in a non-C1/C2 suite.

---

## Gate fix pass (2026-06-24) — CHANGES-REQUIRED → addressed

Gate: `docs/gates/2026-06-24-collate-conflict-source-authority-gate.md` (Critical 1, Important 2, Minor 4).

**[CRITICAL] cross-account bleed in `collate.ts`** — added `.eq('account_id', accountId)` to every
service-role read (`source_authority`, `proposals`, `grove_memory` (+`.maybeSingle()`), `field_meta`)
and to the dedup `update` (defense-in-depth). dupIds derive from the now-account-scoped proposals.

**[IMPORTANT] dead conflict detection** — proposals select now embeds `sources(kind)`
(`select('id, field_key, proposed_value, source_id, status, created_at, sources(kind)')`), so
`p.sources?.kind` carries the real source kind and disagreements actually flag.

**[IMPORTANT] resolve_field_flag missing validation** — added, after the status guard and before any
write: `if p_chosen_source_id is null or not (p_chosen_source_id = any(v_flag.competing_source_ids))
then raise 'chosen source is not among this conflict''s competing sources'`. Guards the NOT-NULL
field_evidence FK insert. Advisory lock / dispatch / audit / learning unchanged.

**Minors** — `source_authority` table → `create table if not exists`; policy → `drop policy if exists`
before create (re-apply safe). Fire-and-forget UI refresh + blank-candidate polish left as TODO per gate.

**Test hardening**
- `collate.test.ts`: mock now records the `.select(...)` string + every `.eq()`/`.in()` filter per
  table, and gates canned data on `.eq('account_id', expectedAccount)`. New `describe` block asserts
  (a) all four owned reads are account-scoped, (b) proposals select embeds `sources(kind)`, (c) a
  wrong-account call sees zero data (scope is load-bearing), (d) dedup update is account-scoped. 21 pass.
- `tests/rls/collate-isolation.rpc.test.ts` (new, live-DB `RlsHarness`): two accounts, each a conflicting
  proposal pair; A's account-scoped proposals read returns only A's rows; flagging A writes a flag
  referencing only A's sources and B's field_flags stay empty; B (non-member) can't see A's flags via RLS;
  A-scoped dedup leaves B's proposals pending. 4 pass.
- `resolve-field-flag.rpc.test.ts`: added cases — resolving with a chosen source NOT in
  competing_source_ids raises (flag stays needs_review); a NULL chosen source raises. 2 added, all pass.

**Verification** — eslint clean; tsc `apps/web` + `tests/rls` clean (no `.next/types` noise); brain
units 197 pass; cron `collate-pass` 7 pass; full `tests/rls` + `apps/web/lib/brain` 586 pass / 1 skip
(pre-existing, unrelated). No banned `console.error(\`…${x}\`,y)`.
