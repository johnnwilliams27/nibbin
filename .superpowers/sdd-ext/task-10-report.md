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
**26 test files, 584 tests — all PASSED**

### New RLS tests (Tasks 1–3)
- `tests/rls/memory-extensible.schema.test.ts` — PASSED (2 tests)
- `tests/rls/section-meta.rpc.test.ts` — PASSED (8 tests)
- `tests/rls/section-meta-delete.rpc.test.ts` — PASSED (7 tests)

### Sources API tests (Task 8)
- `apps/web/app/api/brain/sources/route.test.ts` — PASSED (5 tests)

**Total new tests: 22 PASSED**

## Invariant confirmations

1. **Coral HardRulesBlock renders with authority styling** — CONFIRMED
   - `HardRulesBlock.tsx` uses `--coral-soft` border, `--coral-deep` eyebrow/bullets
   - `HardRulesBlock.test.tsx` passes (included in 584 passing tests)

2. **Reference catch-all renders** — CONFIRMED
   - `MemoryClient.tsx` mounts `ReferenceCatchAll` in the Sources tab panel
   - `ReferenceCatchAll.test.tsx` passes (included in 584 passing tests)

3. **Per-field provenance/staleness slot renders** — CONFIRMED
   - `FieldBlock.tsx` always renders `.provenanceSlot`; when `fieldMeta` is provided, source label + staleness are shown; empty pre-F1
   - `FieldBlock.test.tsx` passes (included in 584 passing tests)

4. **Fresh account (no field_meta rows) renders NEUTRAL 8 defaults** — CONFIRMED
   - `DEFAULT_SECTIONS` in `apps/web/lib/grove/memory-sections.ts` has exactly 7 neutral sections: `about`, `offering`, `how`, `pricing`, `policies`, `voice`, `faq`
   - `buildSectionRegistry([])` returns those 7 (no `hard_rules`/`notes`; they remain separate RPC params)
   - The `memoryPageWiring.test.tsx` "forbidden photographer strings" test passes (no `deposit`/`session`/`shoot`/`photograph` in defaults)
   - `registry.test.ts` "defaults render in canonical order when no meta rows" passes

## Remaining red items

All 8 typecheck errors are pre-existing (origin/main). Zero items from this branch are unresolved.
