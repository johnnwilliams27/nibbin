# Onboarding + Keeper Chat Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the standalone full-bleed `/app/grove` route with one in-shell Keeper companion that is a focal canvas during first-run onboarding and a docked right-rail panel for daily chat — fluid, cohesive, and guided.

**Architecture:** Extract the chat engine out of the monolithic `GroveChat.tsx` into a reusable `KeeperChat` core (message log + composer + actions + keeper sprite). Render it two ways: `OnboardingCanvas` (focal, in-shell, with a stepper) and `KeeperPanel` (docked rail / mobile sheet). `AppShell` gains an `onboarding` mode (quiet/locked nav) and an optional right-rail `panel` slot. Grove Home (`/app`) becomes onboarding-aware and hosts the panel.

**Tech Stack:** Next.js 15 App Router (server components + client islands), CSS Modules, `@nibbin/keeper`, the `components/ui` kit, `@nibbin/creatures`.

**Design source:** `docs/superpowers/specs/2026-06-14-onboarding-chat-integration-design.md` (approved).

**Verification note:** This is frontend/visual work. Logic (state machine wiring, props) is typechecked + linted; **appearance and motion are verified on the Vercel preview deploy** at each phase's checkpoint — there is no headless browser on the dev machine. Each phase ends with: `npx tsc --noEmit -p apps/web` + `npx eslint apps/web` clean, push, and a preview eyeball.

---

## File Structure

**New:**
- `apps/web/app/app/grove/KeeperChat.tsx` — the reusable chat core (log + composer + sprite + turn logic), `variant: 'focal' | 'panel'`.
- `apps/web/app/app/grove/keeper-chat.module.css` — chat-core styles (variant-aware; no full-bleed scene).
- `apps/web/app/app/grove/OnboardingCanvas.tsx` — focal in-shell onboarding host (wraps `KeeperChat variant="focal"` + stepper + hatch).
- `apps/web/app/app/grove/OnboardingStepper.tsx` + `stepper.module.css` — quiet on-brand step indicator.
- `apps/web/app/app/grove/KeeperPanel.tsx` — docked daily chat (`KeeperChat variant="panel"`), rail on desktop / sheet on mobile.
- `apps/web/lib/grove/continuum.ts` — pure helper mapping account state → onboarding continuum step (`meet | about | desktop | connect | live`).

**Modified:**
- `apps/web/components/shell/AppShell.tsx` + `shell.module.css` — add `onboarding?: boolean` (quiet/locked nav) + optional `panel?: ReactNode` (right rail / mobile sheet); point `Grove` nav at `/app`.
- `apps/web/app/app/page.tsx` — onboarding-aware Grove Home: render `OnboardingCanvas` when not `done`, else the dashboard + `KeeperPanel` + continuum next-steps.
- `apps/web/app/app/grove/GroveChat.tsx` — slimmed to re-export / deleted once callers move (kept temporarily for diff clarity, removed in Phase 5).

**Removed (Phase 5):**
- `apps/web/app/app/grove/page.tsx` (route) → redirect to `/app`.
- The full-bleed scene chrome (`SceneLayers`, parallax, `grove.module.css` scene rules) — the keeper sprite + hatch are kept; the separate-world scene is dropped.

---

## Phase 1 — Extract the shared `KeeperChat` core (no visual change)

De-risks everything else. Pull the chat engine out of `GroveChat.tsx` verbatim into `KeeperChat.tsx`, keep `GroveChat` rendering it inside the existing scene so `/app/grove` looks identical. Pure refactor.

### Task 1.1: Create `KeeperChat` with the chat engine

**Files:**
- Create: `apps/web/app/app/grove/KeeperChat.tsx`
- Create: `apps/web/app/app/grove/keeper-chat.module.css`

- [ ] **Step 1: Move the engine.** Create `KeeperChat.tsx` (`'use client'`) exporting `KeeperChat(props)` with the SAME props as today's `GroveChat` plus `variant: 'focal' | 'panel'`. Move into it, unchanged: all `useState`/`useEffect`/`useCallback` from `GroveChat.tsx` lines ~91–435 (items, expression, step, keeperName, profile, os, busy, draft, picked, reducedMotion, hatched, cracking, burstKey; `runTurn`, `advance`, `submitText`, `scanTurn`-free understand/skip handlers, `togglePick`, `submitChannels`, `skip`, `appendKeeperMessages`, the hatch effect, autoscroll). Keep the `KeeperSprite`, the message log, the chips, the composer, and the handoff screen. **Do NOT** move `SceneLayers`, `onPointerMove`/parallax, `theme`/time-of-day, or the `styles.scene` wrapper — those stay scene-only (Phase 1 keeps them in `GroveChat`).
- [ ] **Step 2:** The composer/log/cards markup uses a new `keeper-chat.module.css`. For Phase 1 copy the relevant non-scene classes (`chat`, `log`, `composer`, `inputRow`, `input`, `send`, `chips`, `chip`, `chipConfirm`, `userBubble`, `keeperBubble`, `celebrationCard`, `handoff*`, bubbles) from `grove.module.css` into `keeper-chat.module.css` unchanged. Keep the Enter-focus fix (`disabled={!hatched}`) and the platform-aware handoff already in the source.
- [ ] **Step 3:** `KeeperChat` renders a plain container (`styles.chatRoot`) — no scene. `variant` is accepted but only branches layout in later phases; Phase 1 renders the same inner chat markup for both.
- [ ] **Step 4 (verify):** `npx tsc --noEmit -p apps/web` clean.
- [ ] **Step 5: Commit** `feat(grove): extract reusable KeeperChat core from GroveChat`.

### Task 1.2: `GroveChat` delegates to `KeeperChat`

**Files:** Modify `apps/web/app/app/grove/GroveChat.tsx`

- [ ] **Step 1:** Reduce `GroveChat` to the scene wrapper only: keep `SceneLayers`, `onPointerMove`, `theme`/time-of-day, the `styles.scene` + `KeeperSprite` placement, and render `<KeeperChat variant="focal" {...props} />` inside the scene's chat slot. Remove the duplicated engine now living in `KeeperChat`.
- [ ] **Step 2 (verify):** `npx tsc --noEmit -p apps/web` + `npx eslint apps/web/app/app/grove` clean. `/app/grove` renders identically (no behavior change).
- [ ] **Step 3: Commit** `refactor(grove): GroveChat wraps KeeperChat (no behavior change)`.
- [ ] **Step 4 (checkpoint):** push branch; eyeball the `/app/grove` preview — identical to before.

---

## Phase 2 — `KeeperPanel` (docked daily chat on Grove Home)

### Task 2.1: AppShell gains a right-rail `panel` slot

**Files:** Modify `apps/web/components/shell/AppShell.tsx`, `shell.module.css`

- [ ] **Step 1:** Add `panel?: ReactNode` to `AppShellProps`. When present, render it as a right-rail `<aside className={styles.panel}>` inside `styles.main`, after `styles.content` (desktop: fixed ~380px column; mobile: a toggleable bottom sheet via a new `styles.panelToggle` button + `panelOpen` state). Add `.panel`, `.panelOpen`, `.panelToggle` to `shell.module.css` using existing tokens (`--canopy`, `--line`, shadow) — desktop grid becomes `content | panel`, mobile keeps single column with the sheet overlay.
- [ ] **Step 2 (verify):** typecheck clean; existing pages (no `panel` prop) unchanged.
- [ ] **Step 3: Commit** `feat(shell): optional right-rail panel slot`.

### Task 2.2: `KeeperPanel` component

**Files:** Create `apps/web/app/app/grove/KeeperPanel.tsx`

- [ ] **Step 1:** `KeeperPanel` (`'use client'`) takes the same data props as `KeeperChat` (initialMessages/expression/step/keeperName/credits/profile) and renders `<KeeperChat variant="panel" freshHatch={false} {...props} />` inside a panel header ("Your Keeper" + name). `variant="panel"` in `keeper-chat.module.css`: compact log, sticky composer at the bottom, no sprite theatrics (small keeper avatar in the header instead of the full sprite).
- [ ] **Step 2 (verify):** typecheck clean.
- [ ] **Step 3: Commit** `feat(grove): KeeperPanel docked daily chat`.

### Task 2.3: Wire the panel into Grove Home (done state only, for now)

**Files:** Modify `apps/web/app/app/page.tsx`

- [ ] **Step 1:** In Grove Home, load the same grove_state/turn data `grove/page.tsx` loads (extract the load into `apps/web/lib/grove/load.ts` `loadGroveState(supabase, accountId, userId)` returning `{ state, initialMessages, credits }` so both pages share it — DRY). When `state.step === 'done'`, pass `<KeeperPanel .../>` as `AppShell`'s `panel`.
- [ ] **Step 2 (verify):** typecheck + lint clean.
- [ ] **Step 3: Commit** `feat(home): dock the Keeper panel on Grove Home`.
- [ ] **Step 4 (checkpoint):** push; on the preview, a finished account sees the docked Keeper on `/app` and can chat in it.

---

## Phase 3 — `OnboardingCanvas` + stepper + AppShell onboarding mode

### Task 3.1: `OnboardingStepper`

**Files:** Create `apps/web/app/app/grove/OnboardingStepper.tsx`, `stepper.module.css`

- [ ] **Step 1:** `OnboardingStepper({ current })` where `current: 'meet' | 'about' | 'desktop' | 'live'`. Renders four quiet labelled dots/segments (Meet your Keeper · About you · Set up the app · You're live) with the active one emphasized, using brand tokens (`--moss`, `--line`). Reduced-motion safe.
- [ ] **Step 2 (verify):** typecheck clean. **Commit** `feat(grove): OnboardingStepper`.

### Task 3.2: AppShell onboarding mode (quiet/locked nav)

**Files:** Modify `apps/web/components/shell/AppShell.tsx`, `shell.module.css`

- [ ] **Step 1:** Add `onboarding?: boolean`. When true: render the full shell, but nav items become non-interactive + de-emphasized (`aria-disabled`, `tabIndex=-1`, `styles.navItemQuiet`, no href navigation — render as `<span>` not `<Link>`), and the topbar drops the page nav affordances except Sign out. Add `.navItemQuiet` styling (lower opacity, no hover).
- [ ] **Step 2 (verify):** typecheck clean. **Commit** `feat(shell): onboarding mode with quiet/locked nav`.

### Task 3.3: `OnboardingCanvas` (focal, in-shell)

**Files:** Create `apps/web/app/app/grove/OnboardingCanvas.tsx`

- [ ] **Step 1:** `OnboardingCanvas` (`'use client'`) renders, centered in the shell content area: the `OnboardingStepper` (mapped from `step` via `continuum.ts`), the hatch/`KeeperSprite` delight (reuse the hatch effect + sprite, **without** the full-bleed `SceneLayers`/parallax), and `<KeeperChat variant="focal" {...props} />`. Generous max-width column, brand greens, UI-kit cards. The hatch animation + reduced-motion parity carry over from the current `GroveChat` hatch effect.
- [ ] **Step 2 (verify):** typecheck clean. **Commit** `feat(grove): in-shell OnboardingCanvas (focal)`.

### Task 3.4: Render onboarding in Grove Home + dock transition

**Files:** Modify `apps/web/app/app/page.tsx`

- [ ] **Step 1:** In Grove Home: if `state.step !== 'done'`, render `<AppShell onboarding panel={undefined}>` with `<OnboardingCanvas {...load} />` as the content (focal). If `done`, render the normal dashboard + `KeeperPanel` (Phase 2). 
- [ ] **Step 2:** Dock transition: when the canvas reaches `done` client-side (the handoff screen / completion), animate the canvas → rail. Minimum viable: on completion, navigate/refresh `/app` so it re-renders in the done layout (dashboard + docked panel). Enhanced (preview-iterated): a CSS transition that slides the focal column into the rail. Respect reduced-motion.
- [ ] **Step 3 (verify):** typecheck + lint clean. **Commit** `feat(home): onboarding renders in-shell focal; docks on completion`.
- [ ] **Step 4 (checkpoint):** push; preview a fresh account → onboarding is in-shell, nav quiet, stepper shows, hatch delights, completes → docks to the panel.

---

## Phase 4 — Onboarding-aware Grove Home continuum

### Task 4.1: Continuum helper

**Files:** Create `apps/web/lib/grove/continuum.ts`

- [ ] **Step 1:** `continuumStep({ onboardingStep, hasHandoff, connectionsCount, observerStarted })` → `'meet' | 'about' | 'desktop' | 'connect' | 'live'` (pure). Plus `nextAction(step)` → `{ title, cta, href }` (e.g. desktop → "Download the desktop app" → `/download/mac|windows`; connect → "Connect your accounts in the app"; live → null).
- [ ] **Step 2: Test** `apps/web/lib/grove/continuum.test.ts` — table-driven over the states. **Commit** `feat(grove): onboarding continuum helper`.

### Task 4.2: Grove Home next-step guidance + section fill-in

**Files:** Modify `apps/web/app/app/page.tsx`

- [ ] **Step 1:** When `done` but setup incomplete (no handoff-claimed / no connections / observer not started), surface a prominent **"Get started" card** at the top of Grove Home from `nextAction(continuumStep(...))`, with the Keeper panel nudging. As each milestone completes, the card advances; when `live`, it disappears and the dashboard sections show normally ("fill in"). Use the `components/ui` `Card`/`Button`.
- [ ] **Step 2 (verify):** typecheck + lint clean. **Commit** `feat(home): onboarding-aware next-step continuum`.
- [ ] **Step 3 (checkpoint):** push; preview the post-Q&A home — it always shows one clear next step until `live`.

---

## Phase 5 — Retire `/app/grove`

### Task 5.1: Redirect the old route + remove scene chrome

**Files:** Modify `apps/web/app/app/grove/page.tsx`; remove scene code

- [ ] **Step 1:** Replace `grove/page.tsx` body with `redirect('/app')` (keep the file as a redirect so old links/bookmarks resolve). Update `AppShell` NAV `grove` href to `/app`.
- [ ] **Step 2:** Delete `GroveChat.tsx`, `SceneLayers`, the parallax/time-of-day code, and the scene-only rules in `grove.module.css` (the keeper sprite + hatch + cards now live in `OnboardingCanvas`/`KeeperChat`). Remove now-dead imports.
- [ ] **Step 3 (verify):** `npx tsc --noEmit -p apps/web` + `npx eslint apps/web` clean; `git grep -n "app/grove\"" apps/web` shows no stale links; full `npm run lint` + `npm run typecheck` green.
- [ ] **Step 4: Commit** `refactor(grove): retire /app/grove route; redirect to /app`.
- [ ] **Step 5 (checkpoint):** push; preview — `/app/grove` redirects to `/app`; onboarding + daily chat both live in-shell.

---

## Self-Review

- **Spec coverage:** in-shell focal onboarding (Phase 3), quiet/locked nav (3.2), stepper (3.1), dock transition (3.4), docked daily panel (Phase 2), onboarding-aware home continuum (Phase 4), retire `/app/grove` (Phase 5), shared core / DRY (Phase 1 + `load.ts`/`continuum.ts`). All spec sections map to a task.
- **Visual verification:** every phase ends with a preview checkpoint — appearance/motion is signed off there, not by unit tests (the only unit test is the pure `continuum.ts`).
- **Type consistency:** `KeeperChat` prop set (initialMessages, initialExpression, initialStep, keeperName, freshHatch, credits, initialProfile, variant) is used identically in `GroveChat`, `OnboardingCanvas`, `KeeperPanel`; `continuumStep`/`nextAction` signatures match between 4.1 and 4.2.
- **Risk flagged:** the dock transition (3.4) and panel/focal CSS are the iteration-heavy spots — Step "Enhanced" parts are expected to refine on preview; the minimum-viable (refresh-into-done-layout) keeps each phase shippable.
