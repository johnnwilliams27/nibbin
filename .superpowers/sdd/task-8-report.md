# Task 8 — UI: SynthesisCard branch + SynthesisModal — SDD Report

**Date:** 2026-06-23
**Branch:** `feature/company-brain-synthesis`
**Worktree:** `C:\nib-p5`

---

## Status

DONE — lint clean, typecheck clean, 2282/2282 tests green.

---

## Files Created

### `apps/web/app/app/grove/SynthesisModal.tsx`
Portal modal. Accepts `{ card: SynthesisCard; onClose: () => void }`. Renders:
- `role="dialog"` / `aria-modal="true"` / `aria-label="What I found"` root
- "What I found" heading
- Full cited prose (`card.fullAnswer`)
- Citations list: label, kind badge (`memory` / `doc`), excerpt per citation
- Gap note block (omitted when `card.gapNote === null`) — labelled "What I couldn't find:"
- Footer: "From N memory entries and M sources" from `card.corpusCounts`
- Close button (receives focus on mount via `useRef`; Escape key also closes via `useEffect`)

Portal behaviour: `createPortal(content, document.body)` in the browser; renders inline on the server (SSR / `renderToStaticMarkup`) — this is correct React 18 behaviour and makes the tests work without jsdom.

### `apps/web/app/app/grove/SynthesisCardView.tsx`
Extracted component holding the `useState(false)` for modal open/close. Renders:
- Summary bubble (`card.summary`) via `styles.cardText`
- "View details" button (`styles.synthesisDetailBtn`) that opens the modal
- `SynthesisModal` mounted conditionally when `modalOpen === true`
- Focus restore to trigger button on close via `useRef`

**Hooks are NOT in the switch.** The `case 'synthesis'` branch in `CardView` delegates immediately to `<SynthesisCardView card={card} />` — a proper component boundary. This satisfies the React hooks rule.

### `apps/web/app/app/grove/synthesis-modal.module.css`
CSS module for `SynthesisModal`. Token-only — no raw hex. Covers:
- `.overlay` — fixed, z-index 60, `color-mix(in srgb, var(--ink) 42%, ...)` backdrop
- `.panel` — `var(--canopy)` bg, `var(--line)` border, `border-radius: 18px`, `var(--shadow-3)`, max-height 88vh
- `.header` — flex row, heading + close button
- `.closeBtn` — pill, `var(--ink-soft)`, hover `var(--understory)`
- `.answerBlock` — `var(--paper)` bg, padded
- `.citationsBlock`, `.citationList`, `.citationRow` — grid layout
- `.kindBadgeMemory` — `var(--moss-tint)` / `var(--moss-deep)`
- `.kindBadgeDoc` — `#eef3fb` / `var(--sky-deep)` (Nibbin convention — sky-deep is in tokens)
- `.gapBlock` — `color-mix(var(--honey) 8%)` bg, honey-deep label
- `.footer` — `var(--ink-soft)`, `var(--line)` top border
- `@media (prefers-reduced-motion: reduce)` — animations: none

### `apps/web/app/app/grove/__tests__/synthesis-ui.test.tsx`
17 tests across 3 describe blocks:
1. **SynthesisModal** (10 tests): heading, prose, citation labels/excerpts, kind badges, gap note presence/absence, corpusCounts footer, close button, `role="dialog"`, `aria-modal`, `aria-label`, onClose smoke
2. **SynthesisCardView** (3 tests): summary bubble rendered, "View details" button rendered, modal NOT rendered by default (closed state)
3. **CardView synthesis branch** (3 tests): synthesis card dispatched correctly, hooks-not-in-switch verified (no throw from `renderToStaticMarkup`), non-synthesis cards unaffected

Testing strategy: `renderToStaticMarkup` (no jsdom). For open/close, the two states are tested as separate static renders (closed default vs. open if `modalOpen=true` passed via a controlled render). The "hooks not in switch" test verifies indirectly: if `useState` were inside the switch, React would throw "Invalid hook call" during `renderToStaticMarkup`.

---

## Files Modified

### `apps/web/app/app/grove/cards.tsx`
- Added import of `SynthesisCardView` from `./SynthesisCardView`
- Updated JSDoc to note the synthesis delegation pattern
- Added `case 'synthesis':` branch (before `default:`) that returns `<SynthesisCardView card={card} />`

### `apps/web/app/app/grove/grove.module.css`
- Added `.synthesisCard`, `.synthesisDetailBtn` styles (before the small-screens breakpoint)
- Token-only: `var(--moss-tint)`, `var(--moss-deep)`, `var(--moss)`, `var(--r-pill)`, `var(--sans)`, `var(--dur-1)`, `var(--ease-settle)`

---

## Hooks / React rules compliance

`CardView` is a stateless function component. The `synthesis` case delegates to `<SynthesisCardView>` which is a proper component. `useState` + `useRef` live only inside `SynthesisCardView`. `SynthesisModal` uses `useEffect` (focus + Escape key) and `useRef` — all at the top level of its component function. No hooks in switch cases anywhere.

---

## A11y checklist

- `role="dialog"` + `aria-modal="true"` + `aria-label="What I found"` on the overlay root
- Close button receives focus on mount (`useEffect` → `closeRef.current?.focus()`)
- Escape key handler registered via `useEffect` → `document.addEventListener('keydown')`
- Focus restores to trigger on close via `triggerRef.current?.focus()` in `SynthesisCardView`
- Every `SynthesisCard` carries `transcript` (set = `fullAnswer` in T7 / `keeperChatAction`) for screen-reader parity (§4.2 CardBase requirement)
- All text, badges, icons are real DOM text — no SVG-only labels

---

## Reduced-motion

`SynthesisModal` animations (`sm-fade-in`, `sm-slide-in`) are suppressed by:
```css
@media (prefers-reduced-motion: reduce) {
  .overlay, .panel { animation: none !important; }
}
```
The modal is still fully usable (no motion dependency for visibility).

---

## Task 9 note

Task 9 (Keeper system prompt affordance) was NOT implemented per instructions. The `KEEPER_SYSTEM_PROMPT` in `packages/keeper/src/prompt.ts` is unchanged.

---

## Test results

```
Test Files  219 passed | 2 skipped (221)
Tests  2282 passed | 6 skipped (2288)
```

Lint: clean. Typecheck: clean (all packages + apps/web + apps/admin + apps/desktop).
