# Task 7 Report — Neutral Copy Sweep + Page Wiring

## STATUS: COMPLETE (amended by Task 7 fix: retire legacy field fallback)

## What was done (original Task 7)

### 1. Tests written first (TDD)
- Created `apps/web/app/app/memory/memoryPageWiring.test.tsx` with 16 tests covering:
  - DEFAULT_SECTIONS placeholders contain no forbidden photographer-specific substrings (`deposit`, `session`, `shoot`, `photograph`)
  - FIELD_CONFIG placeholders contain no forbidden substrings
  - Rendered default registry HTML contains no forbidden substrings
  - Dynamic path activation: custom/hidden/renamed `metaRows` drive rendered sections
  - `seedSectionsFromAnswers` seeds `about` not `facts`
  - `forwardMapLegacy` handles stored legacy `facts` correctly
  - HardRulesBlock coral eyebrow + Reference still render with dynamic path

### 2. `seedSections.ts` extracted
- Created `apps/web/app/app/memory/seedSections.ts` as a pure, testable module
- Changed the return key from `{ facts: ... }` to `{ about: ... }` (neutral primary field)
- `page.tsx` now imports `seedSectionsFromAnswers` from this module

### 3. `page.tsx` rewritten
- Removed inline `answerLine` and `seedSectionsFromAnswers` functions (replaced by module import)
- Replaced single `loadFieldMeta()` with `loadFieldMetaAndRows()` that:
  - Queries `field_meta` with ALL registry columns: `field_key, last_reviewed_at, label, sort_order, is_custom, is_hidden`
  - Returns `{ fieldMeta, metaRows }` — both gracefully-degraded on error/absence
  - Coerces null values from pre-migration columns to safe defaults
- Applied `forwardMapLegacy` to field values before passing to `MemoryClient` (non-destructive: `facts` → `about` on read when `about` is empty)
- Passes `metaRows={metaRows}` to `MemoryClient` — **dynamic registry path is now ACTIVE**

---

## What was fixed (Task 7 defect fix — legacy fallback retired)

### Defect
`MemoryClient.tsx` line 99 built `registry = undefined` when `metaRows` was empty (`.length > 0` guard).
`GroveMemoryTab.tsx` then fell back to the legacy photographer-flavoured hardcoded field list
(`legacySection1Fields = ['facts', 'pricing', 'policies']` etc.) for ALL fresh accounts and any
account without customized field_meta rows.

### Fix

**`apps/web/app/app/memory/MemoryClient.tsx`** (1 change):
- Replaced `metaRows && metaRows.length > 0 ? buildSectionRegistry(metaRows) : undefined`
  with `buildSectionRegistry(metaRows ?? [])`.
- `registry` is now always a `SectionDescriptor[]` (7 neutral defaults when metaRows is empty).
- Initial state for `sectionControlsReducer` now passes `registry` directly instead of `registry ?? []`.
- Updated JSDoc on `metaRows` prop to reflect that legacy path is retired.

**`apps/web/app/app/memory/GroveMemoryTab.tsx`** (2 changes):
- Changed `registry` prop from optional (`registry?: SectionDescriptor[]`) to required
  (`registry: SectionDescriptor[]`) — MemoryClient always provides it.
- Removed the entire legacy fallback branch:
  - Deleted `hasRegistry` constant and the `.length > 0` guard.
  - Deleted `legacySection1Fields` and `legacySection2Fields` constants.
  - Deleted the legacy ternary in Section 1 (now simply `registry.map(...)`).
  - Deleted the `{!hasRegistry && legacySection2Fields.map(...)}` block in Section 2.
- Section 1 now unconditionally maps over `registry` (dynamic-only path).
- Section 2 now only contains HardRulesBlock + notes (voice/faq moved to Section 1 via registry).

**`apps/web/app/app/memory/MemoryClient.test.tsx`** (0 legacy tests updated):
- None of the pre-existing assertions relied on the legacy photographer fields; all still pass.
- Added 6 new tests in `'MemoryClient — Task 7 fix: fresh-account neutral defaults'`:
  - Fresh account with `metaRows=[]` renders neutral default sections (`About us`, `What we do`, etc.)
  - Fresh account with `metaRows=undefined` renders same neutral defaults
  - `metaRows=[]` contains NO forbidden photographer substrings (`deposit`, `session`, `shoot`, `photograph`)
  - `metaRows=undefined` contains NO forbidden photographer substrings
  - HardRulesBlock coral eyebrow still renders for fresh accounts (not gated on registry)
  - Both section headings (`About your business`, `Voice & rules`) render for fresh accounts

## Test summary
- **2688 tests pass** across all 235 test files
- **4 pre-existing failures** unchanged (sparticuz-chromium ×3, memory-extensible.schema ×1)
- **0 new typecheck errors** — only the 4 known pre-existing errors remain:
  - `.next/types` stubs (2 errors)
  - `@vercel/analytics` (2 errors, 1 file)
  - `@sparticuz/chromium` (4 errors across 2 files)
- **0 legacy tests updated** (no existing assertion relied on photographer-specific legacy path)
- **6 new tests added** proving fresh-account neutral-default behavior

## Invariants verified
- Coral HardRulesBlock ALWAYS renders (not gated on registry)
- Reference catch-all (Sources tab) still renders
- Provenance slot still wired via `fieldMeta`
- `forwardMapLegacy` ensures stored legacy `facts` data appears as `about` on read
- Section controls (Add/rename/reorder/remove) still wired via sectionControlsDispatch
