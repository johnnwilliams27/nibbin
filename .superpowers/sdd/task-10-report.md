# Task 10 Report — EmptyState, FramingStrip, MemorySection

**Date:** 2026-06-23
**Branch:** `feature/company-brain-memory-redesign`
**Status:** COMPLETE — 29 new tests, 241 total memory tests, lint clean, 0 new type errors

---

## What was built

Three presentational chrome components for the Grove Memory tab, strictly TDD:

### FramingStrip.tsx
- Renders a single-line framing banner in `--understory` bg with `--r-card` radius, `10px 14px` padding (spec §10)
- Contains a decorative leaf SVG glyph (aria-hidden) + the exact §10 copy: "Your Nibbins read this as truth. They'll quote it, paraphrase it, and follow it — every draft."
- `hidden` prop causes the component to return `null` — no DOM node, no layout reservation (correct for first-run and active-edit suppression; parent controls this)
- Token-only CSS: `.framingStrip`, `.framingGlyph`, `.framingCopy`

### MemorySection.tsx
- Purely presentational section wrapper (heading + optional hint + children)
- Uses `<section>` + `<h2>` for semantic landmark structure
- Heading styled as a small-caps eyebrow (11px, `--ink-soft`, 0.1em letter-spacing) to visually subordinate the grouping label to the fields
- `sectionFields` container wraps children in a `--canopy` card with `--line` border + `--r-card` radius, matching the existing `.group` pattern
- Optional `hint` prop only renders `.sectionHint` when provided (tested)
- Token-only CSS: `.memorySection`, `.sectionHeader`, `.sectionHeading`, `.sectionHint`, `.sectionFields`

### EmptyState.tsx
- `'use client'` (uses `buildCreature` which mints unique IDs per render; keeps the SSR/hydration mismatch contained to this component, same strategy as KeeperSprite)
- Renders egg-stage creature at 80×80px via `buildCreature({ species: 'Sprout', stage: 'egg', size: 80 })` with `dangerouslySetInnerHTML` (safe: `safeColor` guard in build.ts validates hex; no user input reaches the engine)
- Copy exactly per §9: "Your grove doesn't know much yet" headline + "Fill in a few sections…makes a real difference." body
- Two ghost affordance chip buttons with `data-field-key` attributes (`facts`, `voice`) + `onChipClick` callback for Task 11 to wire
- `onChipClick` prop is the seam: MemoryClient (Task 11) passes a handler that scrolls + opens the target field in edit mode
- Token-only CSS: `.emptyState`, `.emptyCreature`, `.emptyHeadline`, `.emptyBody`, `.emptyChips`, `.chip`

---

## Test coverage

| File | Tests | What's covered |
|---|---|---|
| `EmptyState.test.tsx` | 9 | SVG rendered, aria-label contains "egg", headline copy, body copy, both chips present, data-field-key attrs, button count ≥ 2, root class, chip class |
| `FramingStrip.test.tsx` | 9 | Framing copy, "every draft" tail, "paraphrase it", aria-hidden glyph, root class, hidden=true→empty string, hidden=false/absent→visible |
| `MemorySection.test.tsx` | 11 | Heading rendered, "Voice & rules" heading, root class, hint rendered when provided, no hint element when absent, single child, ordered children, children appear after heading, sectionHeading class, sectionFields class |

**Total new tests: 29. All pass.**

---

## Gate results

| Check | Result |
|---|---|
| `npx vitest run apps/web/app/app/memory` | 241/241 PASS (11 files) |
| `npm run lint` | CLEAN |
| `npm run typecheck` | 6 pre-existing errors in unrelated files (WebAnalytics, sparticuz) — 0 new errors in memory/ |

---

## CSS additions to memory.module.css

Added three blocks at end of file:
- Task 10: FramingStrip (`.framingStrip`, `.framingGlyph`, `.framingCopy`)
- Task 10: MemorySection (`.memorySection`, `.sectionHeader`, `.sectionHeading`, `.sectionHint`, `.sectionFields`)
- Task 10: EmptyState (`.emptyState`, `.emptyCreature`, `.emptyHeadline`, `.emptyBody`, `.emptyChips`, `.chip`)

All token-only. No raw hex values.

---

## Design decisions / notes

1. **`hidden` vs. `visible` prop on FramingStrip.** Chose `hidden` (opt-in suppression) because the default usage is visible — parent only passes `hidden` when suppressing. Matches how the browser's own `hidden` attribute works.

2. **MemorySection heading as eyebrow.** The spec §3 shows "About your business" / "Voice & rules" as section labels. Made them small-caps eyebrows (`11px`, uppercase, `--ink-soft`, `0.1em` letter-spacing) rather than prominent h2s, so the fields themselves carry visual weight rather than the group headers. Aligns with the `.eyebrow` pattern already in memory.module.css.

3. **EmptyState `'use client'` directive.** `buildCreature` mints unique animation IDs per call. Rendering it server-side in a static-markup test works (SVG is safe), but in the live app the SSR/hydration ID mismatch would cause React warnings. Marking the component `'use client'` matches KeeperSprite's approach. The test still works because `renderToStaticMarkup` doesn't hydrate — it just checks the output string.

4. **`onChipClick` as the chip seam.** Rather than passing field refs or using a context, the chips call `onChipClick(fieldKey)` up to the parent. Task 11 (MemoryClient) provides the handler that scrolls + opens the field. This keeps EmptyState a pure presentational component with no dependency on field state.

---

## Files created / modified

**New files:**
- `apps/web/app/app/memory/EmptyState.tsx`
- `apps/web/app/app/memory/EmptyState.test.tsx`
- `apps/web/app/app/memory/FramingStrip.tsx`
- `apps/web/app/app/memory/FramingStrip.test.tsx`
- `apps/web/app/app/memory/MemorySection.tsx`
- `apps/web/app/app/memory/MemorySection.test.tsx`

**Modified:**
- `apps/web/app/app/memory/memory.module.css` — added 3 new CSS blocks (FramingStrip, MemorySection, EmptyState)
