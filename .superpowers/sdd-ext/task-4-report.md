# Task 4 Report — Dynamic field registry (defaults ∪ field_meta; neutral copy; legacy facts→about)

## Status
COMPLETE — all tests green, no new type errors.

## Files Changed
- `apps/web/lib/grove/memory-sections.ts` — rewrote to 7 neutral sections (about/offering/how/pricing/policies/voice/faq); added `DEFAULT_SECTIONS`, `SectionEntry`, `FieldKind` exports; `MEMORY_SECTIONS` now derived from `DEFAULT_SECTIONS` (shape unchanged for back-compat)
- `apps/web/app/app/memory/registry.ts` — NEW: `buildSectionRegistry(metaRows)` + `forwardMapLegacy(values)` + `SectionDescriptor`/`FieldMetaRow` types
- `apps/web/app/app/memory/fields.ts` — updated `FIELD_CONFIG` (9 keys: 7 neutral + hard_rules + notes), `DEFAULT_SECTION_KEYS`, `CURATED_FIELD_KEYS`; `toRpcPayload` now iterates `DEFAULT_SECTION_KEYS ∪ c_* mirror keys`
- `apps/web/app/app/memory/registry.test.ts` — NEW: 20 tests (DEFAULT_SECTIONS, buildSectionRegistry, forwardMapLegacy)
- `apps/web/app/app/memory/fields.test.ts` — replaced/extended: 44 tests using neutral keys
- `apps/web/app/app/memory/actions.test.ts` — updated 2 tests: replaced `facts` with `about`/neutral keys
- `apps/web/app/app/memory/FieldBlock.test.tsx` — updated 1 test: pricing placeholder string updated

## Test Summary
- registry.test.ts: 20/20 pass
- fields.test.ts: 44/44 pass
- Full memory suite: 398/398 pass
- Full web suite: 1230/1233 pass (3 pre-existing sparticuz failures unrelated to this task)

## Key Decisions
- `MEMORY_SECTIONS` export shape preserved (`{key, label}[]`) — `memory.ts` re-export unchanged
- `facts` is NOT removed from `forwardMapLegacy` — retained so `seedSectionsFromAnswers` in `page.tsx` still writes `facts` without crashing (Task 7 will migrate that to `about`)
- Custom `c_*` keys in the mirror are now included in `toRpcPayload` sections
- No server-only imports added; registry.ts is guard-free/client-safe

## Concerns
- None. `page.tsx`'s `seedSectionsFromAnswers` still writes `facts`; `forwardMapLegacy` bridges on read. This is intentional per plan — Task 7 owns the `page.tsx` seed migration.
