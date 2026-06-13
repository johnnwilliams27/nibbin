# Brief: What Nibbin Can Borrow From Vantor

**Author:** Claude (UX investigation)
**Date:** 2026-06-13
**Status:** Recommendations → implementation plan in `docs/vantor-borrow-plan.md`

Comparative study of the Vantor (crypto-treasury) platform against the Nibbin web app
**and** desktop (Observer) app, to identify what we can borrow to make Nibbin feel more
cohesive, fluid, and complete — especially in **account management**. The goal is to
borrow **structure and interaction patterns**, not Vantor's aesthetic. Every pixel gets
reskinned in Nibbin's grove tokens.

---

## The core diagnosis

Vantor feels more polished not because of its colors, but because of **three structural
things Nibbin's web app does not have yet**:

1. **A persistent app shell.** Vantor wraps every authenticated page in
   `AppShell → Sidebar + Topbar`. You always know where you are, navigation is one click,
   and route changes fade rather than hard-cut. Nibbin's web app has **no shell** — every
   page (`/app`, `/app/grove`, `/app/shop`, `/billing`) is a standalone island navigated
   by inline text links. This is the single biggest "fluidity" gap.

2. **A shared UI kit.** Vantor has ~20 reusable primitives (`badge`, `tab-nav`,
   `filter-bar`, `spinner`, skeletons, `confirm-dialog`, `card`, `inline-success`…).
   Nibbin has **design tokens but no components** — the `.primary` button is copy-pasted
   across `billing.module.css`, `shop.module.css`, and `login.module.css`. Consistency by
   discipline, not by construction.

3. **An account-management hub.** Vantor has a real `/settings` area: accounts/team,
   billing (tabbed), notifications (3-channel grid), integrations. Nibbin has **zero
   settings surface** — no `/account`, no `/settings`, no profile editing, no password
   change. The `users` table stores `name`/`locale`/`tz` the UI never lets you edit.

The foundation (tokens, brand system, DB/RLS) is solid. This is about adding a layer, not
a rebuild — and **not** copying Vantor's look, only its structure.

---

## A. The cohesion layer (highest leverage)

Build a Nibbin app shell. Port the **structure** of Vantor's `AppShell.tsx` /
`Sidebar.tsx` / `Topbar.tsx`, reskinned in grove tokens:

- Persistent left nav (grove-themed): Grove · Shop · Notifications · Billing ·
  **Settings (new)**
- Topbar with page title, notification bell (the leaf pile already exists), and an avatar
  dropdown → port Vantor's `SettingsMenu.tsx` (name/email, sign out, quick prefs).
- Route-change fade-in (Vantor's `fade-in` keyframe) — cheap, large perceived-polish win.
- Mobile: hidden sidebar + hamburger overlay (Vantor's exact pattern).

This change kills the "bleak" feeling more than any single page.

---

## B. Fixing the bleak post-login home

The approval queue is described in our own docs as "the product's heartbeat" but it is
buried in `/app/grove`; the home is two stat boxes + links. Borrowing Vantor's card/stat
patterns:

- **Surface the approval queue on home** — pending draft cards ("Waiting on you") as the
  hero, not a number.
- **Creature presence / report cards** — per-Nibbin stage, accuracy %, run count
  (`stat-card` + `card` variants map cleanly).
- **Activity ledger** — reverse-chron, plain-language "what your agents did."
- **Shape-matched skeletons** (Vantor's `operations-skeletons.tsx`) instead of full-page
  SSR blanks.

Framed as a lightweight down-payment on the planned M4.5 "Grove Home," not a replacement.

---

## C. Account management — the explicit gap

Nibbin is missing nearly the entire surface. Build a `/settings` hub mirroring Vantor's
structure, scoped to the solo-freelancer ICP:

| Setting | Vantor source to borrow | Nibbin status today |
|---|---|---|
| **Profile** (name, timezone, locale) | `settings/accounts` org card | Stored in DB, **no edit UI** |
| **Security** (change password, sessions, sign-out-everywhere) | auth flows + `SettingsMenu` | Only password *reset* exists |
| **Billing** (plan, usage/quota, invoices, payment method) | `settings/billing` (tabbed) | Plan + top-up only; rest punts to Stripe portal |
| **Notifications preferences** (per-category, email toggle) | `settings/notifications` 3-channel grid | Mark-read only; code says "no settings toggle exists yet" |
| **Connected accounts** (list integrations, revoke) | `settings/integrations` | Connector code exists (M3), **no UI** |
| **Data** (export, deletion) | — (Vantor weaker here) | Post-M7, not built |

Highest-value, lowest-effort first: **Profile edit + Change password + a real Billing page
with usage breakdown.** These are what a paying Grove/Canopy subscriber expects on day one
and currently cannot find.

Keep from Vantor (fits the brand): its **structured error envelope**
(`reason_code + human_readable + user_action + trace_id`). We already hold the principle
that errors must be human-actionable; `src/lib/policy/errors/` is the reference.

---

## D. Polish primitives to port (build the kit)

Create a shared web UI kit and port these, reskinned — this stops copy-paste drift:

- **`Badge`** with semantic tinted variants (`bg-{color}/8 border-{color}/20`).
- **`TabNav`** with the sliding indicator (needed for the billing tabs in C).
- **`ConfirmDialog`** with type-to-confirm — for destructive grove actions.
- **`InlineFeedback`** (auto-dismiss) instead of URL-query-param status messages.
- **`Spinner` + skeletons** — there are no loading states today.
- **`Card` variants** + **`InfoTooltip`**.
- **Global tabular numerals** (`font-feature-settings: 'tnum'`) — one CSS line, instant
  credibility for credit/usage numbers.

---

## E. Desktop (Observer) — macOS **and** Windows

The desktop app is a **Tauri** app targeting **both** — `bundle.targets: ["dmg","app","msi"]`.

- **Shared & solid on both OSes:** auth (PKCE → system browser → `nibbin://` deep link →
  OS keychain: Apple Keychain on macOS, DPAPI/Credential Manager on Windows), redaction
  pipeline, day-14 study enforcement, and shared design tokens (it already reuses
  `@nibbin/shared/tokens.css`).
- **macOS is ahead; Windows is M8 parity.** Both capture modules
  (`crates/nibbin-capture/src/{macos,windows}.rs`) are currently fail-loud stubs pending
  hardware bring-up. Hotkey differs correctly (⌘⇧. vs Ctrl+Shift+.).
- **Two concrete gaps:** (1) `entitlements.plist` is referenced in `tauri.conf.json` but
  missing from the repo — blocks macOS notarization; (2) the Windows MSI has
  `certificateThumbprint: null` — unsigned, causing SmartScreen warnings.

Desktop UX recommendations (apply to both platforms — the UI is shared TS):

- **No Settings/Preferences screen exists** — device controls (pause, exclusions,
  delete-everything) are scattered across Study/Review/Account tabs. Add a **Preferences**
  tab, consistent across mac + Windows.
- **Account tab parity:** reads plan/credits but has no sign-out confirmation and no quota
  display — small ports from the web `SettingsMenu`.
- Keep the deliberate split (account-level → web, device-level → desktop), but make the
  desktop Account tab link clearly into the new web `/settings` hub so it is not a dead end.

---

## What NOT to copy

- Vantor's dark-only, teal, dense "treasury terminal" aesthetic — wrong for the warm grove
  brand. Borrow structure and interaction patterns; reskin every pixel in Nibbin tokens.
- Vantor's heavy RBAC/team matrix — the ICP is solo freelancers. Skip team management
  until there is a multi-seat need.

---

## Suggested sequencing

1. **App shell + route-fade** (A) — unblocks everything, kills bleakness fastest.
2. **UI kit package** (D) — small, but every later screen depends on it.
3. **Settings hub: Profile + Security + Billing** (C) — the flagged account-management gap.
4. **Home enrichment: approval queue + report cards** (B).
5. **Notifications prefs + connected-accounts UI** (C, second wave).
6. **Desktop Preferences tab + signing/entitlements fixes** (E).
