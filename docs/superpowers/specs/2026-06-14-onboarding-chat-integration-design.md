# Onboarding + Keeper chat integration — design

**Date:** 2026-06-14
**Status:** Design aligned, pending review
**Why:** Onboarding is the highest drop-off moment. Today the Keeper chat is a standalone full-bleed route (`/app/grove`) that feels like a *separate world* from the app — jarring to enter/leave and signalling "you're not in the product yet." We want one continuous, in-product experience.

## Principle

One Keeper companion that changes **prominence, never place**. The user is inside `AppShell` from second one — same nav, branding, tokens — warmly guided, with a visible finish line. The thing you onboard *with* becomes your daily companion.

## The continuum

Onboarding is not a gate before a dead dashboard. It runs **web → Grove Home → desktop**, with the Keeper as the through-line and a visible next step the whole way:

`Meet your Keeper → Tell it about you → Set up the desktop app → Connect → You're live`

## Three Keeper states (all inside the shell)

1. **Focal (first-run onboarding).** The Keeper chat is the centered main canvas — generous whitespace, brand greens, the UI kit, the hatch/naming delight intact — but unmistakably the app.
   - **Shell:** full chrome shown (logo + nav) so it reads as the product; nav is **de-emphasized and locked** during required steps to prevent wandering off (decision: "visible but quiet/locked").
   - **Progress:** a **quiet, on-brand stepper** (Meet → About you → Desktop → Live) + the Keeper's conversational nudges (decision: "quiet stepper + Keeper guidance"). Clear finish line without feeling like a form.
2. **Dock transition.** When the understanding Q&A completes, the focal Keeper **animates into the right rail** and Grove Home resolves around it — continuity, not a cut.
3. **Daily (docked).** ~380px right rail on desktop; full-screen sheet on mobile (the Vantor agent-panel pattern). Same chat core (`keeperChat`), always available on Grove Home.

```
ONBOARDING (focal)                         DAILY (docked)
┌ shell: logo · quiet/locked nav ┐         ┌ shell: full nav ───────────┬─────────┐
│  ●───────●───────○  stepper     │         │ Grove Home                 │ Keeper  │
│      🌱 Keeper (focal, centered)│   ──▶   │ approval queue · sections  │ docked  │
│      ┌ card / question ┐        │  dock   │ "next: download · connect" │ rail    │
│      [ your answer …… ]         │  anim   │                            │ chat    │
└─────────────────────────────────┘         └────────────────────────────┴─────────┘
```

## Onboarding-aware Grove Home (the drop-off saver)

Right after the Q&A, Grove Home keeps guiding rather than showing a blank dashboard:
- A **"Get started" continuum** surfaces the next concrete step (download desktop → connect → start the Observer) with the docked Keeper nudging.
- Dashboard sections **fill in as real setup completes**, giving a "your grove is coming to life" payoff.
- The home is **onboarding-aware**: it knows where the user is in the continuum and always shows one clear next action until setup is truly done.

## Components

- **`AppShell` onboarding mode** — a prop/variant that renders full chrome with nav quiet + locked.
- **`OnboardingCanvas`** — the focal in-shell layout hosting the Keeper conversation (re-homes the hatch/naming/understanding flow + cards from today's `GroveChat`, minus the full-bleed parallax scene).
- **`OnboardingStepper`** — quiet, on-brand step indicator.
- **`KeeperPanel`** — the docked daily chat (right rail / mobile sheet), sharing the chat core with `OnboardingCanvas`.
- **`GroveHome` onboarding-awareness** — next-step continuum + section fill-in.
- **Shared chat core** — extract the message log + composer + `keeperChat`/understanding actions so `OnboardingCanvas` and `KeeperPanel` render the same primitives (DRY).

## Retired / changed

- The standalone full-bleed `/app/grove` route + its parallax scene chrome are retired; the keeper/hatch/cards/delight are re-homed in-shell. (Keep the creature/sprite + hatch animation; drop the separate-world framing.)
- The Enter-focus fix, curated tz/locale, and signup auto-detect (PR #82) are independent and already in flight.

## Phasing

1. **Shared chat core** extraction (log + composer + actions) — no visual change, de-risks the rest.
2. **`KeeperPanel`** docked daily chat on Grove Home (+ `AppShell` right-rail / mobile sheet).
3. **`OnboardingCanvas` + stepper + AppShell onboarding mode** — re-home the first-run flow in-shell; dock transition.
4. **Onboarding-aware Grove Home** continuum + section fill-in.
5. Retire `/app/grove` route; redirect to `/app`.

## Open considerations

- Exact dock animation (morph vs. cross-fade) — settle during build with motion that respects reduced-motion (existing rule in `GroveChat`).
- Mobile: focal onboarding is full-height in-shell; daily docked is a bottom sheet / toggle.
- Accessibility parity (transcripts, live regions) carries over from `GroveChat`.
