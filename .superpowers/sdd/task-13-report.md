# Task 13 — Sources Tab: Reference Catch-All + EvidenceList

**Date:** 2026-06-23
**Branch:** `feature/company-brain-memory-redesign`
**Commit:** (see git log)

---

## Status: COMPLETE — green

All 339 memory unit/component tests pass (16 test files).
Lint: clean. Typecheck: pre-existing errors only (verified against prior commit).

---

## What was built

### New files

| File | Purpose |
|------|---------|
| `apps/web/app/app/memory/ReferenceCatchAll.tsx` | Freeform reference_text catch-all (view/edit, `<pre>` display, Show all affordance, empty nudge copy) |
| `apps/web/app/app/memory/ReferenceCatchAll.test.tsx` | 28 tests: view/empty/edit mode + reducer logic (pure) |
| `apps/web/app/app/memory/EvidenceList.tsx` | Gated F1 evidence store (graceful empty banner pre-F1; source cards when enabled) |
| `apps/web/app/app/memory/EvidenceList.test.tsx` | 13 tests: empty state + evidence rows |
| `apps/web/app/app/memory/SourcesTab.tsx` | Tab panel assembly: Reference section + Evidence section |

### Modified files

| File | Change |
|------|--------|
| `apps/web/app/app/memory/MemoryClient.tsx` | Replaced Sources stub with `<SourcesTab>`; promoted `referenceRef → useState(referenceValue)`; wired `handleSaveReference` with optimistic update + rollback |
| `apps/web/app/app/memory/memory.module.css` | Added token-only CSS for: SourcesTab, ReferenceCatchAll, EvidenceList |

---

## Key decisions

### ReferenceCatchAll
- Uses the same deliberate edit pattern (view → edit → save/cancel) as curated fields
- Reuses `editReducer` from Task 7 — no new reducer needed
- View mode renders `<pre>` with `white-space: pre-wrap` (no structural formatting, §8.1)
- `SHOW_ALL_THRESHOLD = 500` chars triggers the "Show all" button (static in SSR; Task 14 wires the toggle interaction)
- `testMode` prop bypasses `useState` so `renderToStaticMarkup` tests can drive state directly (same pattern as FieldBlock, HardRulesBlock)
- `onSave` signature: `(value: string) => Promise<void>` — MemoryClient builds FormData and calls `saveReference`

### EvidenceList
- Does NOT import any F1 schema type at module scope (build-safe pre-F1 constraint met)
- Row data typed as local `SourceRow` plain interface
- Gate: `sourcesEnabled` prop (driven by `process.env.SOURCES_ENABLED`) AND `rows.length > 0`
- Empty banner uses `--understory` background; no spinner
- Empty banner copy from §8.2: "Everything Nibbin has read or watched…"

### MemoryClient changes
- `referenceRef` → `useState(referenceValue)` so the Sources tab panel gets the value as a reactive prop
- `handleSaveReference`: optimistic update → `saveReference(fd)` → rollback + re-throw on `!result.ok`
- `void handleSaveReference` workaround removed (the handler is now actively consumed by `SourcesTab`)

### SourcesTab
- `SOURCES_ENABLED` env gate is read at render time (`process.env.SOURCES_ENABLED === 'true'`)
- Default is false everywhere until F1's tables exist
- The tab shows both sections regardless of gate — it's only the EvidenceList content that gates

---

## Test coverage (Task 13 additions: 41 new tests)

### ReferenceCatchAll.test.tsx (28 tests)
- View mode with value: label, `<pre>`, Edit button, no textarea, no empty nudge
- View mode long value: "Show all" affordance threshold (> 500 chars)
- View mode empty: nudge copy, no `<pre>`, label still present, Edit still present
- Edit mode: `<textarea>`, current value, Save/Cancel buttons, no `<pre>`, label, no Edit button
- Reducer logic (pure): enter/change/cancel/save/saveSuccess transitions via `editReducer`

### EvidenceList.test.tsx (13 tests)
- Empty state: graceful banner copy, understory class, no spinner, no cards — for `rows=[]`, `sourcesEnabled=false`, and `sourcesEnabled=false` even with rows
- With rows (sourcesEnabled=true): cards rendered, count, kind labels, excerpt text, "Last seen"

---

## Typecheck note

The pre-existing errors in `typecheck` output (7 errors in `.next/types`, `WebAnalytics.tsx`, `lib/planner/browser.ts`) were confirmed present on the prior commit (Task 12) before any Task 13 changes. These are not introduced by this task.

---

## Open concerns (for Task 14 / PR gate)

1. **"Show all" / "Collapse" toggle** — the button is rendered statically; the expand/collapse interaction is deferred to Task 14 (motion pass). The `aria-expanded="false"` attribute is set; Task 14 should wire the actual toggle.
2. **No sources rows loaded from server** — `SourcesTab` currently receives no `sourceRows` prop from `MemoryClient`; the page.tsx would need to load sources from F1 if `SOURCES_ENABLED=true`. This is acceptable pre-F1 (the gate keeps the empty banner showing). F1 integration will pass rows through page.tsx → MemoryClient → SourcesTab when ready.
3. **`handleSaveReference` rollback on optimistic update** — rolls back `referenceValue` to the previous value on failure. The ReferenceCatchAll component manages its own `localValue` state independently; on failure the error surfaces via the `ReferenceEditor`'s `onSave` throw, which dispatches `saveError` and shows the error in the editor. The rollback of `referenceValue` in MemoryClient ensures consistency if the tab is switched away and back.
