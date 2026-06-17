# Field Study — Entry-Point Fix (NIB-2) + UX Upgrade (NIB-7) — Design Proposal

**Date:** 2026-06-17
**Branch:** feature/field-study
**Status:** Design proposal — for product-owner review. No code written.
**Scope:** `apps/desktop` Field Study tab only. Grove tab and the web app are reference, not in scope.

This is a proposal to react to, not a final spec. Each section leads with a recommendation and lists
the trade-offs behind it.

---

## 0. TL;DR

- **NIB-2 root cause:** The entry buttons (`entryView()`) exist and are correct, but they only render
  for three study states — `NOT_STARTED`, `COMPLETE`, `DELETED`. Every *other* state the daemon can
  report — most importantly **`DAEMON_OFFLINE`** — falls through `paint()`'s `default` branch into
  `stateView()`, which for `DAEMON_OFFLINE` renders a dead-end "Field study isn't running" message
  **with no start button and no recovery action.** A user whose daemon hasn't written its status file
  yet (cold boot, status-file race, or a daemon that failed to start) sees a wall, not a start. This
  is compounded by the entry living one click *behind* the non-default Grove tab.
- **NIB-2 fix direction:** Make "start" reachable from the offline/unknown states too — treat
  `DAEMON_OFFLINE` (and any unrecognized state) as "no study is capturing, here's how to begin,"
  not as a terminal error. Add a daemon-health affordance instead of a dead end.
- **NIB-7:** The Field Study sub-nav is four bare text buttons with no icons, no titles, no section
  identity, and a near-invisible active state. Grove sets the bar with an icon+label sidebar, a sticky
  titled topbar, clear active treatment, and a locked "onboarding" affordance. Bring the same hierarchy,
  active-state clarity, and empty/loading/error consistency to Field Study using existing tokens only.

---

## 1. NIB-2 — Root cause + fix

### 1.1 The state machine, traced

`apps/desktop/src/ui/main.ts` boots with `tab = 'grove'` (main.ts:16) and only renders Field Study when
the user clicks the second tab (main.ts:35 → `fieldStudyView(render)`).

`fieldStudyView()` (`apps/desktop/src/ui/views/field-study.ts:289`) holds a sub-nav (`home / review /
notes / preferences`) and a `paint()` dispatcher. `paint()` (field-study.ts:314) calls
`bridge.studyStatus()` and switches on `status.state`:

| `status.state`         | Renders                                         | Has a "start" button? |
|------------------------|-------------------------------------------------|-----------------------|
| `NOT_STARTED`          | `entryView()` (field-study.ts:323)              | **Yes**               |
| `CONSENTED`            | `consentView()`                                 | continues a started flow |
| `ACTIVE` / `PAUSED`    | `studyView()` or `quickScanView()`              | n/a (already running) |
| `COMPLETE` / `DELETED` | `stateView()` **+ `entryView()`** (field-study.ts:342) | **Yes** |
| **everything else**    | `default:` → `stateView()` only (field-study.ts:347) | **No** |

The `default` branch swallows `REVIEW`, `SYNTHESIZING`, `RAW_DELETING` (correct — a study is mid-flight)
**and `DAEMON_OFFLINE`** (wrong — nothing is running, the user *should* be able to start).

### 1.2 Where `DAEMON_OFFLINE` comes from

- `apps/desktop/src/ui/bridge.ts:46-53` — `studyStatus()`'s **fallback** (no Tauri shell, e.g. browser
  dev) is `{ state: 'DAEMON_OFFLINE', study: null, ... }`.
- `apps/desktop/src-tauri/app/src/commands.rs:39-44` — `read_status()` returns
  `{ "state": "DAEMON_OFFLINE" }` whenever `daemon.status` **cannot be read** (missing file, parse
  error). On a cold start the daemon writes `daemon.status` only after `write_status()`
  (`observerd/src/lib.rs:438`) runs its first tick; until then the webview reads
  `DAEMON_OFFLINE`. A daemon that fails to launch leaves the file absent indefinitely.

So an onboarded user with no active study sees `NOT_STARTED` **only if** the daemon is up and has
written status at least once. Any gap — first-paint race, daemon crash, daemon not yet spawned — lands
them in `stateView('DAEMON_OFFLINE', …)`.

### 1.3 What `DAEMON_OFFLINE` renders today

`stateView()` for `DAEMON_OFFLINE` (field-study.ts:169-177):

> **"Field study isn't running"** — *"The background process… is offline. Nothing records while it's
> down. Start it from the menu bar, or reinstall if this keeps happening."*

No "Start a 14-day field study." No "Quick scan." No retry. **This is the concrete dead end the tester
hit.** The copy even *tells* the user to look at the menu bar — pushing them out of the window that is
supposed to own the flow.

### 1.4 Root cause (one line)

> The start actions are gated to `NOT_STARTED` / `COMPLETE` / `DELETED`; the realistic "no study yet,
> daemon not (yet) reporting" condition reports `DAEMON_OFFLINE`, which routes to a no-action error
> screen — so a real user sees no way to start.

### 1.5 Fix direction (recommended)

1. **Re-home the entry on offline/unknown.** In `paint()`, treat `DAEMON_OFFLINE` (and the `default`
   for any unrecognized state) as an *entry* state, not a terminal one: render `entryView()` plus a
   small, honest **daemon-health note** ("Starting the background watcher…" with a Retry that re-polls
   `studyStatus()`). When the user clicks "Start a 14-day field study," the existing
   `createStudy → consentView → consent/start` path runs; if the daemon truly is down, `sendControl`
   writes to `control.jsonl` and the daemon consumes it on launch — so the click is never wasted.
2. **Distinguish "offline" from "starting."** Optionally have the UI poll `studyStatus()` a few times
   on mount (short backoff) before deciding the daemon is genuinely offline vs. merely cold — this
   removes the first-paint race entirely without changing Rust.
3. **Keep the hard-offline guidance, but secondary.** If retries keep returning `DAEMON_OFFLINE`, show
   the menu-bar/reinstall guidance *beneath* the still-present entry cards, never *instead of* them.

**Trade-off / decision needed:** option (1) alone is a pure UI change (lowest risk, ships now). Option
(2) is also UI-only but adds a poll loop. A belt-and-suspenders alternative is to have the Rust side
report a distinct `NOT_STARTED`-equivalent when `study.json` is absent even if `daemon.status` is
missing — but that crosses into the daemon and is **out of scope** for a UI-quality fix. Recommend
**(1) + (2)**, UI-only.

---

## 2. Entry-point design (14-day + ad-hoc)

The two entries already exist in `entryView()` (field-study.ts:188-249) and are well-written: a
"Start a 14-day field study" card and a "Quick scan a task" card with a labeled task input. The work is
**reachability and state coverage**, not net-new flows.

### 2.1 Where the entry lives

- **Recommended:** Field Study tab is the home for both entries, and `entryView()` becomes the
  fallback for *every* non-running, non-mid-flight state (`NOT_STARTED`, `COMPLETE`, `DELETED`,
  `DAEMON_OFFLINE`, unknown). One canonical "How do you want to start?" surface.
- The Grove tab stays the default landing (it's the product home). **Decision for owner:** should
  Grove surface a "Start a field study" call-to-action that deep-links to the Field Study tab, so a
  user who never clicks the second tab can still discover the flow? (Recommended: yes, a single
  unobtrusive link — see §4.)

### 2.2 What each entry shows (unchanged copy, confirmed against consent)

- **14-day field study:** card titled *"Start a 14-day field study"*, one primary button
  → `begin('full_study', null)` → mints a UUID via `createStudy` → `consentView(…, 'full_study')`.
- **Ad-hoc / quick scan:** card titled *"Quick scan a task"*, a task label input (≤80 chars), primary
  button → validates non-empty label → `begin('quick_scan', label)` → `consentView(…, 'quick_scan')`.

### 2.3 Setup / consent each requires

Both routes pass through the **same** `consentView` (`apps/desktop/src/ui/views/consent.ts`), which
fires `consent` then `start` on confirm. The only per-kind difference is the **"When it ends"** claim
line (consent.ts:14-17): 14-day hard stop vs. "stops when you tell it to, or after a few hours." No new
consent surface is needed — this is correct and should stay shared.

### 2.4 Empty / active / complete states

| Condition                     | Surface (recommended)                                            |
|-------------------------------|-----------------------------------------------------------------|
| **Empty** (no study / offline)| `entryView()` — both cards, always reachable (the NIB-2 fix)     |
| **Consent pending**           | `consentView()` for the chosen kind                             |
| **Active — full study**       | `studyView()` — 14-day countdown, pause/resume, end early       |
| **Active — quick scan**       | `quickScanView()` — task label, "Capturing" chip, Stop scan     |
| **Mid-flight** (review→delete)| `stateView()` for `REVIEW` / `SYNTHESIZING` / `RAW_DELETING`     |
| **Complete / deleted**        | `stateView()` receipt **+ `entryView()`** to start the next one  |

This table already holds *except* for the Empty/offline row — which §1.5 fixes.

### 2.5 Making "start" obvious and reachable

- Entry cards always render in the non-running states (the fix).
- The Field Study **tab** should carry a subtle "needs action" cue when no study is active (see §3.3)
  so a user parked on Grove notices there's something to begin.
- Primary buttons keep the existing `button.primary` moss treatment — already the strongest affordance
  in the desktop token set.

---

## 3. NIB-7 — UX upgrades, Grove-referenced

### 3.1 What makes Grove feel polished (reference)

From `apps/web/components/shell/AppShell.tsx` + `shell.module.css`:

1. **Iconed, labeled nav** — every item pairs a Lucide-style line icon with a label
   (AppShell.tsx:31-121); icons inherit `currentColor` so they tint with the active state.
2. **Unmistakable active state** — `.navItemActive` plus `aria-current="page"` (AppShell.tsx:183-186);
   hover and active are visually distinct, with token-driven transitions
   (`shell.module.css:54,60,64`).
3. **Sticky titled topbar** — a per-page `title` and account/sign-out cluster (AppShell.tsx:195-214)
   so the user always knows *where they are*.
4. **A "locked but visible" mode** — onboarding renders the whole shell but de-emphasizes and disables
   nav (AppShell.tsx:166-177) — a finish-line affordance without dead clicks.
5. **Consistent empty/loading language** — the Grove tab's own loading state is a purpose-built
   "sprouting" animation (`grove.ts`, `.grove-loading` in observer.css) that reads as *growing*, not
   *stalled*.

### 3.2 The Field Study sub-nav today (the gap)

`fieldStudyView()` renders `nav.subnav` as four **bare text buttons** — `Field study / Review /
Field notes / Preferences` (field-study.ts:295-311). The active item gets only
`.nav button[aria-current='true']` → a faint `understory` background + darker border
(observer.css:212-215). No icons, no section title, no count/empty cues, weak active contrast. Next to
Grove it reads as a debug toolbar.

### 3.3 Concrete upgrades (tokens only, no new design system)

1. **Iconed sub-nav.** Give each of the four sections an inline line-icon (same `stroke=currentColor`,
   18px, `viewBox 0 0 24 24` convention Grove uses) so the nav reads as sections, not buttons. Icons
   live in the desktop bundle; no dependency added. *(~matches AppShell `NavIcon`.)*
2. **Stronger active treatment.** Promote `.nav button[aria-current='true']` to a moss-tinted pill
   (reuse `chip.active`'s `rgba(91,124,46,0.14)` + `moss-deep` text) so the current section is obvious
   at a glance, matching Grove's `.navItemActive` clarity. Keep `aria-current` for a11y.
3. **A section title row.** Each sub-view already emits an `eyebrow` + `h1` (e.g. review.ts:18-19,
   notes.ts:15-16). Standardize them as a lightweight titled header band so Field Study has the same
   "you are here" anchor Grove's topbar gives — no new topbar component, just consistent placement.
4. **Tab-level "needs action" cue.** When `studyStatus()` is non-running, mark the **Field Study tab**
   (in `main.ts`'s tabbar) with a small dot/affordance so a user on Grove sees there's a study to
   start — the desktop equivalent of Grove's notification "Leaves" entry.
5. **Consistent empty / loading / error.** Today `reviewView` shows "Loading…" and `notesView` shows
   "Counting…" as bare muted text. Replace with the established loading pattern (reuse the `sync-card`
   left-rail or the sprout loader idiom) and give each section a real **empty state** ("No events kept
   yet — your review fills up as the study runs") instead of an empty card. This mirrors Grove's
   "loading reads as growing" polish.
6. **Offline as a state, not a wall.** Per §1.5, the `DAEMON_OFFLINE` screen becomes entry cards + a
   quiet health note + Retry — the same "visible but recoverable" spirit as Grove's onboarding-locked
   shell, never a dead end.

All six reuse existing tokens (`--moss`, `--understory`, `--canopy`, `chip.active`, `sync-card`,
`sprout-loader`, `dur/ease` vars). **No new color, duration, or component primitive.**

### 3.4 Explicitly out for NIB-7

- No persistent left **sidebar** for the desktop app — the two-tab shell (Grove | Field Study) +
  sub-nav is the agreed information architecture (main.ts:1-5 comments). We're raising the *quality* of
  the existing sub-nav, not replacing the navigation model.
- No icon library dependency — inline SVGs only.

---

## 4. Open questions / decisions for the product owner

1. **Offline-state fix depth.** Ship §1.5 option (1) UI-only (entry always reachable), or (1)+(2)
   (add a short re-poll loop to distinguish "starting" from "offline")? *Recommend (1)+(2).*
2. **Grove → Field Study discovery.** Should the Grove tab carry a "Start a field study" call-to-action
   that deep-links to the Field Study tab, so users who never click tab 2 can still find the core flow?
   *Recommend yes — one subtle link.*
3. **Do 14-day and ad-hoc share one flow?** They already share `createStudy` + `consentView` and differ
   only in `kind`/`label`/backstop. Confirm we keep them as **one shared flow, two entry cards** (not
   two divergent wizards). *Recommend keep shared.*
4. **Tab-level "needs action" cue.** Is a dot/affordance on the Field Study tab desirable, or does it
   add noise to a two-tab shell? *Recommend a quiet dot only when no study is running.*
5. **Ad-hoc scope reminder.** The quick-scan backstop is 6h and the label cap is 80 chars (existing).
   Confirm these stay — no scope change requested here, but they're the two ad-hoc knobs worth a glance.

---

## 5. Scope boundary

**In scope (this Field Study effort):**
- UI-only fix so "start" is reachable from `DAEMON_OFFLINE` / unknown states (NIB-2).
- Field Study sub-nav + per-section UX upgrades using existing tokens (NIB-7).
- Empty/loading/error consistency within the four Field Study sections.
- Optional UI re-poll loop and a Grove→Field Study deep-link.

**Out of scope:**
- **Daemon / Rust changes.** The status-reporting contract (`commands.rs`, `observerd`) stays as is;
  the fix lives in the webview. (A Rust change to report a distinct "no study" state is noted as an
  alternative, not adopted.)
- **The capture/consent/segmentation pipeline and privacy invariants** (C1/C2/C3/C7) — unchanged.
- **Anything depending on Connections or the onboarding handoff** — the entry assumes an already
  authenticated, onboarded user (the auth gate in `main.ts:boot()` runs first); we do not touch the
  login/onboarding sequence.
- **The Grove tab and the web app** — reference only; no changes.
- **Account-level settings** — they deliberately live in the web app (preferences.ts:1-5); not revisited.
