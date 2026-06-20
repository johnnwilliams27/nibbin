# Web UX Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the "AI-slop" feel (decorative pills, naked empty fields, oversized whitespace) and unify the shell's motion language across the web app — inherited by the desktop shell automatically.

**Architecture:** Pure presentation + motion. CSS Modules + the shared design tokens in `packages/shared/tokens.css`; React server/client components in `apps/web`. No backend or schema changes.

**Tech Stack:** Next 15 App Router, React 19, CSS Modules, design tokens (`--ease-spring`, `--ease-snap`, `--ease-settle`, `--dur-1..4`, spacing scale).

## Global Constraints

- No new dependencies. Token-only styling — no hard-coded colors/easings; use `packages/shared/tokens.css` variables.
- Verification gate per task: `npm run lint` clean, `npm run typecheck` clean (modulo the known local `@nibbin/*` workspace-resolution noise — confirm changed files are error-free), `npm run build` green, plus the stated visual check. Commit after each task.
- Respect `prefers-reduced-motion: reduce` in every motion change.
- Nibbin voice for all copy (warm, brief; see in-repo brand-voice doc).
- Run from a worktree; land via feature branch → PR → the 4 CI checks.

---

### Task 1: Shared motion tokens — single easing + duration vocabulary

**Files:**
- Modify: `packages/shared/tokens.css` (confirm/add `--ease-spring`, `--ease-snap`; add `--motion-reveal` easing + `--motion-reveal-dur` if not present)
- Reference: `apps/web/components/shell/shell.module.css`, `apps/web/app/app/grove/keeper-dock.module.css`

**Why:** Today the nav uses `--dur-2 var(--ease-settle)`; the dock rail uses `--dur-4` with a raw `cubic-bezier(0.65,0,0.35,1)`; the mobile sheet uses `--dur-3` with the same raw bezier. Three different timings for "panel slides in." Define one reveal easing + duration token pair so chrome motion is consistent.

- [ ] **Step 1:** Inspect `packages/shared/tokens.css` for existing `--ease-*`/`--dur-*` values. Add (if absent) `--motion-reveal: <the chosen spring/settle easing>` and `--motion-reveal-dur: <chosen duration>` with a comment that nav + dock both use them.
- [ ] **Step 2:** `npm run build` — confirm tokens compile (no CSS error).
- [ ] **Step 3:** Commit: `style(tokens): add shared reveal motion tokens for shell chrome`.

### Task 2: Unify the left-nav collapse/expand motion with the dock

**Files:**
- Modify: `apps/web/components/shell/shell.module.css` (`.sidebar` transition line ~25, `.main` margin transition ~183)

- [ ] **Step 1:** Change `.sidebar` and `.main` transitions to use `var(--motion-reveal-dur) var(--motion-reveal)` (from Task 1) instead of `--dur-2 var(--ease-settle)`, keeping the transitioned properties (`transform`, `width`, `margin-left`).
- [ ] **Step 2:** Confirm the `@media (prefers-reduced-motion: reduce)` block still nulls these transitions.
- [ ] **Step 3:** Visual check: collapse/expand the nav on desktop — motion should feel identical in timing/easing to opening the Keeper dock (verify side-by-side after Task 3).
- [ ] **Step 4:** `npm run lint && npm run build`; commit: `style(shell): nav collapse uses shared reveal motion`.

### Task 3: One adaptive dock reveal (rail + sheet share grammar)

**Files:**
- Modify: `apps/web/app/app/grove/keeper-dock.module.css` (rail transition ~45/53, sheet transition ~174/182)

**Why:** Desktop rail (`--dur-4`) and mobile sheet (`--dur-3`) animate at different speeds with a raw bezier, so switching viewports feels jarring. Make both the *same* transform grammar (translate + opacity) at the *same* timing — only the axis differs (X for rail, Y for sheet).

- [ ] **Step 1:** Replace the rail open/close transition (lines ~45, ~53) with `transition: transform var(--motion-reveal-dur) var(--motion-reveal), opacity var(--motion-reveal-dur) var(--motion-reveal);` (drop the raw `cubic-bezier`).
- [ ] **Step 2:** Replace the mobile-sheet transition (lines ~174, ~182) with the same token-based transition (same duration/easing); keep `translateY(100%)→0` for the sheet axis and `translateX(100%)→0` for the rail.
- [ ] **Step 3:** Confirm the reduced-motion block (line ~251) nulls both.
- [ ] **Step 4:** Visual check: open/close the dock on desktop (rail from right) and at `<880px` (sheet from bottom) — same speed/easing, no jarring difference; and it matches the nav from Task 2.
- [ ] **Step 5:** `npm run lint && npm run build`; commit: `style(dock): single adaptive reveal motion (rail + sheet unified)`.

### Task 4: Reusable empty-state component

**Files:**
- Create: `apps/web/components/ui/EmptyState.tsx` + `empty-state.module.css`
- Modify: `apps/web/components/ui/index.ts` (export it)

**Why:** Multiple surfaces show a bare card + whitespace for "nothing yet." Centralize a designed empty state (small creature glyph + one Nibbin-voice line + optional action) so no surface invents its own bare version.

- [ ] **Step 1:** Build `EmptyState({ title, body, action? })` — a centered block: a small creature/leaf SVG (reuse an existing creature glyph or the `nibbin-mark` sprout), a bold `title`, a soft `body` line, and an optional `action` (button/link). Token-only spacing; max-width so it doesn't sprawl.
- [ ] **Step 2:** Export from `components/ui/index.ts`.
- [ ] **Step 3:** `npm run lint && npm run typecheck && npm run build`.
- [ ] **Step 4:** Commit: `feat(ui): EmptyState component for designed empty states`.

### Task 5: Apply EmptyState + tighten the NotificationCenter and other web empty/whitespace offenders

**Files:**
- Modify: `apps/web/components/shell/notification-center.module.css` / `NotificationBell.tsx` (the `.empty` state), and any web page rendering a bare "nothing yet" card (grep `className={.*empty` / "Nothing " across `apps/web/app/app`).

- [ ] **Step 1:** Grep `apps/web/app/app` for bare empty states (e.g. "Nothing finished yet", "No events"). For each, swap the bare card for `<EmptyState …>`.
- [ ] **Step 2:** Audit the same surfaces for oversized gaps; tighten to the spacing scale (no ad-hoc large margins).
- [ ] **Step 3:** Visual check each touched surface.
- [ ] **Step 4:** `npm run lint && npm run typecheck && npm run build`; commit: `style(web): designed empty states + tightened spacing`.

### Task 6: Pill audit — status-only

**Files:**
- Reference/Modify: `apps/web/components/ui` (Badge) usages across `apps/web/app/app`.

**Why:** Pills should mark status/state, never decorate or carry counts. (The worst offender, "Observer · 1 moments", lives in the desktop native UI deleted by the thin-shell — so this task is the *web* sweep.)

- [ ] **Step 1:** Grep `<Badge` across `apps/web/app/app`. For each, classify: status/state (keep) vs decorative/count (convert to inline text, fix grammar/pluralization).
- [ ] **Step 2:** Apply conversions; ensure counts read as natural inline text ("1 moment kept", not a pill).
- [ ] **Step 3:** Visual check; `npm run lint && npm run build`; commit: `style(web): pills for status only; counts inline`.

### Task 7: Memory page redesign

**Files:**
- Modify: `apps/web/app/app/memory/page.tsx`, `apps/web/app/app/memory/memory.module.css`

**Why:** The page is 7 stacked textareas (`MEMORY_SECTIONS` + hard_rules + notes); when empty it's a wall of empty fields + whitespace — the "slop" the user called out. Keep the curated-memory model (it's correct) but make it feel composed and guided.

- [ ] **Step 1:** Group the sections visually (e.g. "About your work" = facts/pricing/policies; "Voice & rules" = voice/faq/hard_rules/notes) with section headers, so it reads as an organized profile not a flat form.
- [ ] **Step 2:** Replace the all-empty first-run experience: when every section is empty, lead with a short `EmptyState`-style intro ("Your grove doesn't know much yet — fill in what helps") above a collapsed/progressive set, rather than 7 equally-empty boxes. When sections have content, show them expanded.
- [ ] **Step 3:** Tighten spacing to the scale; make filled fields visually distinct from empty placeholders so progress is legible.
- [ ] **Step 4:** Keep the `saveGroveMemory` action + field `name`s unchanged (no behavior change).
- [ ] **Step 5:** Visual check (empty account + populated account); `npm run lint && npm run typecheck && npm run build`; commit: `feat(memory): composed, guided Memory page (de-slop)`.

### Task 8: Final review + PR

- [ ] **Step 1:** Re-walk every touched surface at desktop + mobile widths and with reduced-motion on.
- [ ] **Step 2:** `npm run lint && npm run typecheck && npm run build` clean.
- [ ] **Step 3:** Open PR → main; ensure the 4 CI checks pass. (No gated paths touched → no adversarial gate.)

---

## Self-Review

- **Spec coverage:** anti-slop principles → Tasks 4,5,6,7; motion unification → Tasks 1,2,3; Memory redesign → Task 7. ✓
- **Placeholders:** none — token values are chosen during Task 1 against the real `tokens.css` (the one intentional "inspect then set" step, not a deferral).
- **Consistency:** `--motion-reveal`/`--motion-reveal-dur` defined in Task 1 and consumed in Tasks 2–3; `EmptyState` created in Task 4 and consumed in Tasks 5,7.
- **Note:** the "1 moments" pill + naked Field-Study inputs live in the desktop native UI removed by the thin-shell plan, not here — this plan is the web sweep.
