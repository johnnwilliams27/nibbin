# Task 7 Report — Neutral Copy Sweep + Page Wiring

## STATUS: COMPLETE

## What was done

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

### 4. Dynamic path activation confirmed
The `MemoryClient` already had the `metaRows` prop and `buildSectionRegistry` call from Task 6. Page.tsx now passes non-empty `metaRows` when field_meta rows exist for the account, activating the dynamic rendering path instead of the legacy fallback.

## Test summary
- **480 tests pass** across all 22 memory test files
- **0 new typecheck errors** — only the 4 known pre-existing errors remain:
  - `.next/types` stubs (2 errors)
  - `@vercel/analytics` (2 errors, 1 file)
  - `@sparticuz/chromium` (4 errors across 2 files)

## Dynamic path status
**ACTIVE.** When field_meta rows exist for an account, `page.tsx` now passes `metaRows` to `MemoryClient`, which calls `buildSectionRegistry(metaRows)` and renders the dynamic registry instead of the legacy hardcoded field list. Empty/pre-migration accounts degrade gracefully to defaults.

## Verified invariants
- Coral HardRulesBlock ALWAYS renders (not gated on registry)
- Reference catch-all (Sources tab) still renders
- Provenance slot still wired via `fieldMeta`
- `forwardMapLegacy` ensures stored legacy `facts` data appears as `about` on read
