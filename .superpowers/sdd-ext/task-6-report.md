# Task 6 Report — Add / rename / reorder / remove UI

## Status
COMPLETE

## Files created/modified
- **Created**: `apps/web/app/app/memory/sectionControls.reducer.ts` — pure state machine (MOVE_UP/DOWN swap sort_orders; CONFIRM_REMOVE: default→upsert_hide, custom→delete; START_ADD/EDIT_LABEL/CONFIRM_ADD/CANCEL; CLEAR_INTENT)
- **Created**: `apps/web/app/app/memory/AddSectionControl.tsx` — "+ Add a section" affordance; hidden in view mode; inline form in adding mode
- **Created**: `apps/web/app/app/memory/SectionActions.tsx` — per-field move-up/move-down/remove controls; hidden in view mode; first/last items disable the appropriate move button
- **Modified**: `apps/web/app/app/memory/GroveMemoryTab.tsx` — added `registry?`, `isEditing?`, `sectionControlsState/Dispatch`, `onSectionIntent` props; renders dynamic registry fields when provided, falls back to legacy static list for back-compat; mounts AddSectionControl + SectionActions in edit mode; HardRulesBlock + Reference unchanged
- **Modified**: `apps/web/app/app/memory/MemoryClient.tsx` — added `metaRows?` prop; builds dynamic registry via `buildSectionRegistry(metaRows)`; wires `sectionControlsReducer`; handles all intent types (upsert_hide/upsert_new/upsert_pair→`saveSectionMeta`; delete→`deleteSection`); passes everything to GroveMemoryTab
- **Modified**: `apps/web/app/app/memory/memory.module.css` — added CSS classes for section controls: `.addSectionRow`, `.addSectionBtn`, `.addSectionForm`, `.addSectionInput`, `.addSectionError`, `.addSectionActions`, `.sectionActions`, `.sectionMoveBtn`, `.sectionRemoveBtn`
- **Created**: `apps/web/app/app/memory/sectionControls.reducer.test.ts` — 29 reducer tests
- **Created**: `apps/web/app/app/memory/AddSectionControl.test.tsx` — 9 render tests
- **Created**: `apps/web/app/app/memory/SectionActions.test.tsx` — 10 render tests

## Test summary
21 test files, 464 tests — all pass. New: 48 tests (29 reducer + 9 AddSectionControl + 10 SectionActions). Existing 21 tests (including MemoryClient.test.tsx, HardRulesBlock.test.tsx, FieldBlock.test.tsx) all pass unchanged.

## Typecheck
`npm run typecheck` shows ONLY the 4 known pre-existing errors:
- `.next/types/app/api/connect/google/callback/route.ts` (stub)
- `.next/types/app/api/cron/nibbin-schedule/route.ts` (stub)
- `@vercel/analytics/next` (missing dep)
- `@sparticuz/chromium` (missing dep)

No new TypeScript errors introduced.

## Key design decisions
- **Backward compat**: GroveMemoryTab falls back to legacy static field list when no registry provided; MemoryClient passes registry only when metaRows are non-empty. Existing tests pass without any metaRows.
- **Pure reducer**: All state transitions produce new state + intent payload. Components are dumb renderers.
- **Intent dispatch**: MemoryClient owns the async server action calls; components dispatch reducer actions only.
- **Custom key detection**: `^c_` regex — CONFIRM_REMOVE routes to delete vs upsert_hide based on this.
