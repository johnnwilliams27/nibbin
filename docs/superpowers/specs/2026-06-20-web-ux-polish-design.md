# Web UX Polish — Design

**Date:** 2026-06-20
**Status:** Design (approved in brainstorming; pending spec review → implementation plan)

## Goal

Remove the "AI-slop" feel from the web app and unify its motion language. Independent of the thin-shell work, but the thin shell inherits every improvement automatically (desktop = the web app). Three threads: **anti-slop principles** (applied app-wide), **motion unification**, and a focused **Memory tab redesign**.

## Thread 1 — Anti-slop principles (app-wide)

These become house rules, audited across the web app (and therefore the shell):

- **Pills are for status/state only** — live, connected, stage, version, "watching." Never decorative, never for counts. Today's offenders include "Observer · *1 moments*" (also grammatically wrong). Counts become inline text: "1 moment kept."
- **Empty states are designed, not bare.** A near-empty card floating in whitespace ("No events kept yet") gets a purposeful treatment: a small creature, one line of Nibbin-voice copy, and a clear next action. No dead space standing in for content.
- **Whitespace follows the spacing scale.** Tighten oversized gaps; cards should feel composed, not marooned. Denser, intentional layouts that match the loved surfaces (Grove home, roster).
- **No naked inputs.** A lone text field with no surrounding context (e.g. "Never record this again" / "Add exclusion") gets an inline label, helper text, and the action paired tightly — an input *unit*, not a stray box.

Deliverable: a short audit pass that applies these to the worst surfaces first (the ones the thin shell will surface: Review, Field notes, Preferences, plus Memory below), then a sweep of the rest.

## Thread 2 — Motion unification

Today the left-nav open/close and the Keeper dock open/close animate differently, and the Keeper dock's mobile (slide up from bottom) vs. desktop (slide in from right) motions feel like two unrelated animations.

- **One easing vocabulary.** All shell chrome motion uses the design-system tokens (`--ease-spring` / `--ease-snap`) with shared durations. The left-nav collapse/expand and the Keeper dock open/close use the **same** timing + easing so they read as one system.
- **One adaptive dock reveal.** The Keeper dock becomes a single "reveal from edge" concept that *adapts* to viewport — bottom-sheet on mobile, side-rail on desktop — with consistent enter/exit timing and easing, so switching contexts isn't jarring. Same transform grammar (translate + fade), same spring, just a different edge.
- **Respect `prefers-reduced-motion`** throughout (already partially in place — make it consistent).

Primary files: `components/shell/AppShell.tsx` + `shell.module.css` (nav), `app/app/grove/KeeperDock.tsx` + `keeper-dock.module.css` (dock). The implementation plan pins the exact selectors/tokens.

## Thread 3 — Memory tab redesign

The Memory tab reads as slop: decorative pills, an empty field, too much whitespace. Redesign to make the account's actual semantic memory legible:

- **Dense, scannable list** of real memory entries (what Nibbin has learned), with meaningful grouping/recency — not pill-decorated cards in whitespace.
- **Purposeful empty state** (Nibbin voice + a creature) when there are no entries yet, instead of an empty field + bare card.
- **Honest controls** — if there's a search/add affordance, it's a proper input unit per Thread 1; if it isn't earning its place, remove it (YAGNI).

The exact current layout will be read from the Memory page source when writing the implementation plan; the design intent is the above.

> Note: the Memory tab, nav-motion, and dock-motion examples were described in text, not in the 2026-06-19 screenshots (those were all the desktop Field Study). A Memory-tab screenshot would sharpen the redesign but isn't blocking — the plan grounds it in the page source.

## Scope

Web app only. No backend/schema changes expected (presentation + motion). Inherited by the desktop shell.

## Out of scope

The thin-shell rewrite (`2026-06-20-thin-shell-observer-design.md`). These two can ship in either order; web-polish is the lower-risk one.
