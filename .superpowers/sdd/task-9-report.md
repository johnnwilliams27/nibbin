# Task 9 Report — HardRulesBlock (coral authority treatment)

**Status:** COMPLETE — green  
**Commit:** (see git log)  
**Tests:** 30 new tests pass (212 total memory suite, 0 failures)  
**Lint:** clean  
**Typecheck:** 6 pre-existing errors (WebAnalytics/sparticuz) — none introduced by Task 9

---

## What was built

### Files created
- `apps/web/app/app/memory/HardRulesBlock.tsx` — The coral authority component
- `apps/web/app/app/memory/HardRulesBlock.test.tsx` — 30 tests (TDD, red→green)

### Files modified
- `apps/web/app/app/memory/memory.module.css` — Added 11 new coral authority classes

---

## Design decisions

### Coral as authority signal (§7)
Used `--coral-soft` for the left border (a softer weight befitting a structural marker, not an alarm) and `--coral-deep` for the eyebrow text and bullet squares (high-contrast ink for authority emphasis). The ::before pseudo-element on `.ruleBullet` renders a 6×6px square with `border-radius: 1px` — visually a square, not a dot. This deliberately distinguishes hard-rules bullets from ordinary `disc` list bullets.

### Reused FieldEditor directly (no reimplementation)
Task 9 routes edit mode through the existing `FieldEditor` component (Task 7), passing `hint="Your Nibbins never break these. One rule per line."` — consistent with the plan's direction to reuse Task 6/7/8 machinery. The `editReducer` / `initialState` from Task 7 is reused for the round-trip reducer tests.

### Pure helpers exported for tests
`rulesArrayToString` and `rulesStringToArray` are exported as named exports so the reducer round-trip tests can verify save behavior without touching the DOM. These are the canonical split/join functions — the same logic `toRpcPayload` in `fields.ts` already applies; `HardRulesBlock` converts rules[] → raw string to seed the editor, and `MemoryClient`'s `onSave` → `toRpcPayload` handles the array re-split for the RPC.

### testMode prop pattern (same as FieldBlock)
A `testMode?: 'view' | 'edit'` prop bypasses internal useState, allowing `renderToStaticMarkup` tests to assert both modes without DOM event simulation. This follows the exact pattern established by FieldBlock (Task 8).

### Empty state
When `rules.length === 0`, renders "No hard rules yet" in `.hardRulesEmpty` (faint, italic) instead of an empty `<ul>`. The coral container and eyebrow are always shown — the authority header is visible even when no rules are defined yet, prompting the user to add them.

---

## Test coverage (30 tests)

| Group | Count | What |
|---|---|---|
| Pure helpers | 6 | round-trip, filter, join, empty |
| View — coral authority | 8 | classes, eyebrow, sub-label, li+ruleBullet, Edit btn, no textarea |
| View — empty state | 4 | placeholder text, coral class, Edit btn, no `<ul>` |
| Edit mode | 6 | textarea, rules one-per-line, coral class, hint, Save/Cancel, no ruleBullet |
| Edit round-trip (reducer) | 6 | enter seeds draft, change marks dirty, clean cancel exits, saveSuccess, rules→string→array stable |

---

## Pre-existing typecheck noise (not Task 9)
`WebAnalytics.tsx` (`@vercel/analytics/next`) and `browser.ts`/`sparticuz-args.test.ts` (`@sparticuz/chromium`) produce 6 TS2307/TS7006 errors on the base branch. Verified by stashing Task 9 and re-running — identical errors. Task 9 introduces zero new typecheck failures.

---

## Concerns / notes for reviewer

1. **CSS `::before` square bullet**: The bullet is a pure CSS pseudo-element (no extra DOM node). It uses `background-color: var(--coral-deep)` and `border-radius: 1px` to render as a small square. If the design evolves to want a different glyph (e.g. `▸`), swap the `content` on `.ruleBullet::before` without changing HTML.

2. **`--coral-soft` token**: Used for the left border. Confirm this token exists in the global CSS. It appears in the pre-existing `.error` class and the plan explicitly names it. If the token is missing in some environments, the border degrades gracefully (no color = still has the 3px border structure).

3. **onSave signature**: `onSave('hard_rules', rawNewlineString)` — the field key matches FIELD_CONFIG's `hard_rules` key so MemoryClient's `toRpcPayload` will split correctly. The caller does not need to do anything special for this field.

4. **No provenance slot**: HardRulesBlock does not render a provenance slot (unlike FieldBlock). The plan's Task 9 spec does not call for one — hard rules are user-authored gospel, not sourced from field study. If F1 provenance is ever added, it should be done in a follow-up, not here.
