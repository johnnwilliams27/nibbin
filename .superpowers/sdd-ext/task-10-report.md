# Task 10 Report — Full-suite green + provenance/staleness intact

Date: 2026-06-23

## Commands run

```
npm run lint
npm run typecheck
npx vitest run apps/web/app/app/memory
npx vitest run tests/rls/memory-extensible.schema.test.ts tests/rls/section-meta.rpc.test.ts tests/rls/section-meta-delete.rpc.test.ts
npx vitest run apps/web/app/api/brain/sources
```

## Results

### Lint
**Before fixes:** 5 errors (all from this branch's new files)
**After fixes:** 0 errors, 0 warnings

Fixes applied:
- `apps/web/app/api/brain/sources/route.test.ts:185` — `let` → `const` (never-reassigned)
- `apps/web/app/app/memory/memoryPageWiring.test.tsx:27` — removed unused `import type { FieldMeta }`
- `apps/web/app/app/memory/registry.test.ts:13` — removed unused `type SectionDescriptor` from import
- `apps/web/app/app/memory/registry.ts:16` — removed unused `type SectionEntry` from import
- `apps/web/app/app/memory/sectionControls.reducer.test.ts:21` — removed unused `type SectionControlsAction` from import

### Typecheck
**Result:** 8 remaining errors — ALL pre-existing, none from this branch

Evidence (confirmed via `git log --oneline origin/main..HEAD -- <file>` returning empty for all):
1. `apps/web/.next/types/app/api/connect/google/callback/route.ts` (TS2344) — stale generated stub, route not touched by this branch
2. `apps/web/.next/types/app/api/cron/nibbin-schedule/route.ts` (TS2344) — stale generated stub, route not touched by this branch
3. `apps/web/app/WebAnalytics.tsx` (TS2307+TS7006) — introduced by commit `986c5c9f` on main (`@vercel/analytics` optional dep absent in worktree)
4. `apps/web/lib/planner/browser.ts` (TS2307) — introduced by commit `33ca8ef6` on main (`@sparticuz/chromium` optional dep absent in worktree)
5. `apps/web/lib/planner/sparticuz-args.test.ts` (TS2307 × 3) — same as above

### Memory test suite
**26 test files, 587 tests — all PASSED** (up from 584; 3 new gate-fix tests)

### New RLS tests (Tasks 1–3)
- `tests/rls/memory-extensible.schema.test.ts` — PASSED (2 tests)
- `tests/rls/section-meta.rpc.test.ts` — PASSED (8 tests)
- `tests/rls/section-meta-delete.rpc.test.ts` — PASSED (7 tests)

### Sources API tests (Task 8)
- `apps/web/app/api/brain/sources/route.test.ts` — PASSED (6 tests; +1 new ilike-escape test)

**Total gate-fix tests added: 4 new tests all PASSED**

## Gate fixes applied (2026-06-23 gate round)

### Important 1 — Slug collision uniqueness (`actions.ts`)
Added `resolveUniqueFieldKey()` helper that:
1. Slugs the label via `labelToFieldKey()` to get the base key.
2. Queries `field_meta` for the account to get all existing keys.
3. If the base key collides, appends `_2`, `_3`, … up to `_999`, clamping the
   body so the suffix always fits within the 40-char body limit.
4. The EDIT path (existing `field_key` in FormData) passes the key through
   unchanged — no re-slug, no uniqueness check.

Tests added:
- `two labels that slug to the same base key get DISTINCT generated keys` — proves `c_my_stuff` + `c_my_stuff_2`
- `renaming an existing section does NOT create a new key (edit path passes key through)`

Stub updated: `supabaseStub` in `actions.test.ts` now supports `.from().select().eq()` chain for the `field_meta` query.

### Minor 1 — ilike metacharacter escape (`route.ts`)
`params.q` is now run through `.replace(/[\\%_]/g, c => '\\' + c)` before building the `%…%` ilike pattern, so `%`, `_`, and `\` in user input are treated as literals.

Test added:
- `escapes % in q before passing to ilike so it is treated as a literal substring` — asserts `a%b` → `%a\%b%`

### Minor 2 — Stale "8 neutral defaults" comment (`MemoryClient.tsx`)
Changed `"8 neutral default sections"` → `"7 neutral default sections"` in the Task 7 fix comment at line 98.

### Minor 3 — Reorder no-op with equal sort_orders (`sectionControls.reducer.ts`)
MOVE_UP and MOVE_DOWN now detect when the two siblings share an equal `sortOrder`. In that case, instead of swapping equals (a no-op), index-proportional values are assigned to the affected pair to guarantee a visible, distinct ordering. The upsert_pair intent is always emitted.

Test added (inside the MOVE_UP describe block):
- `MOVE_UP is deterministic when two siblings share an equal sort_order`

## Invariant confirmations

1. **Coral HardRulesBlock renders with authority styling** — CONFIRMED
   - `HardRulesBlock.tsx` uses `--coral-soft` border, `--coral-deep` eyebrow/bullets
   - `HardRulesBlock.test.tsx` passes (included in 587 passing tests)

2. **Reference catch-all renders** — CONFIRMED
   - `MemoryClient.tsx` mounts `ReferenceCatchAll` in the Sources tab panel
   - `ReferenceCatchAll.test.tsx` passes (included in 587 passing tests)

3. **Per-field provenance/staleness slot renders** — CONFIRMED
   - `FieldBlock.tsx` always renders `.provenanceSlot`; when `fieldMeta` is provided, source label + staleness are shown; empty pre-F1
   - `FieldBlock.test.tsx` passes (included in 587 passing tests)

4. **Fresh account (no field_meta rows) renders NEUTRAL 7 defaults** — CONFIRMED
   - `DEFAULT_SECTIONS` in `apps/web/lib/grove/memory-sections.ts` has exactly 7 neutral sections: `about`, `offering`, `how`, `pricing`, `policies`, `voice`, `faq`
   - `buildSectionRegistry([])` returns those 7 (no `hard_rules`/`notes`; they remain separate RPC params)
   - The `memoryPageWiring.test.tsx` "forbidden photographer strings" test passes (no `deposit`/`session`/`shoot`/`photograph` in defaults)
   - `registry.test.ts` "defaults render in canonical order when no meta rows" passes

## Remaining red items

All 8 typecheck errors are pre-existing (origin/main). Zero items from this branch are unresolved.

## NOT fixed (per instructions)

- `group='other'` route no-op + client-side filtering over the server-capped 50-row fetch — documented follow-up, left alone per gate instructions.
