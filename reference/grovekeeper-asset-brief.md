# Grovekeeper — studio asset brief & integration contract

Goal: a production Grovekeeper you author once (Rive editor or AI image tool), that I
wire across the product. Reference: `reference/Screenshot 2026-06-16 210654.png`
(the acorn-crowned keeper with star satchel + lantern staff).

---

## Brand palette (use these exact hexes for consistency)

| Part | Hex |
| --- | --- |
| Body green (base → shade) | `#82AD4D` → `#5B7C2E` |
| Leaves (light / mid / vein) | `#9CC25B` / `#7FAF45` / `#5F8F33` |
| Acorn nut / cap | `#CE9152` / `#8A5A30` |
| Wood staff (light / dark) | `#845231` / `#5C3A20` |
| Leather satchel (body / flap) | `#9C6B3B` / `#B5824A` |
| Brass + lantern glow / core | `#C8941F` / `#E8C44A` / `#FFF6C8` |
| Outline | `#3F5A1F` |
| Eyes (pupil) / cheeks | `#2C2A22` / `#E8917A` |
| Paper background | `#FBF7EC` |

Style: soft, friendly, **flat vector with gentle cel-shading + soft ambient shadows**
(a step above pure flat). Rounded forms, generous highlights, no harsh contrast.
Think Duolingo/Headspace mascot polish — warm and approachable, not glossy 3D.

---

## Route A — Rive (recommended for app + landing)

Author in the free Rive editor, import the reference as a guide, build a clean vector
rig, then export a single `.riv`. Match these names so my integration code binds without edits:

- **Artboard:** `Grovekeeper`, 512×512, transparent, character centered with ~8% padding.
- **State machine:** `Keeper` with inputs:
  - `blink` (trigger) — fires the blink
  - `wave` (trigger) — one-shot wave (for greetings / onboarding)
  - `talking` (boolean) — subtle mouth/bob loop while the Keeper "speaks"
  - `mood` (number 0–2) — 0 idle, 1 happy/celebrate, 2 thinking
- **Always-on idle:** breathing bob, periodic auto-blink, leaf sway, lantern swing + glow pulse.
- Keep the lantern + leaves on their own bones so they can swing/sway independently.

Deliver: `grovekeeper.riv` + confirm the state-machine/input names above.

## Route B — AI image set (fastest; static or hand off to a rigger later)

Paste this into your image tool (the one that made the reference), generate a sheet,
upscale, export **transparent PNG at 3×**:

> Flat vector mascot character sheet, single consistent character: a small round
> moss-green forest "keeper" creature with a smooth rounded body, big friendly
> oval eyes with twin catchlights, tiny rosy cheeks, a gentle smile. On its head an
> acorn (tan nut `#CE9152`, brown cap `#8A5A30`) with three small leaves sprouting
> up. A brown leather messenger satchel `#9C6B3B` with a gold star on the flap, worn
> crossbody (strap on the chest, never over the face). Holding a wooden walking
> staff with a curled hook at the top from which a small glowing brass lantern hangs.
> Body green `#5B7C2E`, leaves `#9CC25B`/`#7FAF45`, outline `#3F5A1F`. Soft cel
> shading, gentle ambient shadows, warm and approachable, Duolingo-mascot polish.
> Plain transparent background. Character sheet: front idle, blinking, waving,
> happy/celebrate, thinking — same character, consistent proportions and palette.

Deliver: a transparent **hero PNG (≥1024², 3×)** plus the **expression frames**.
(If you also want it rigged, this art can be traced in Rive afterward.)

---

## What I need from you (hand-off contract)

Drop any of these into `reference/grovekeeper/` and tell me which route:

- **Rive:** `grovekeeper.riv` + the state-machine/input names (or confirm the defaults above).
- **Lottie:** `grovekeeper.json` (After Effects → Bodymovin export) + marker/segment names.
- **Images:** transparent PNGs — `hero@3x.png` + one per expression, same canvas size.

## How I'll integrate it

- **Landing + app (web):** Rive via `@rive-app/react-canvas` (or `lottie-react`),
  wrapped in a `<Grovekeeper state=… />` component driving the state machine. Lazy-loaded,
  reduced-motion fallback to a static frame.
- **App shell / grove ceremony:** same component, `talking`/`mood` driven by Keeper dialogue.
- **Emails:** animation can't run in email clients — I'll export one **static PNG frame**
  for the transactional header (replaces the current engine `Keeper`).
- **Canonical swap:** today `packages/creatures` renders the Keeper as code-drawn SVG
  (`species.ts`, `canonical: true`). We keep that as the lightweight fallback and add the
  studio asset as the hero — or fully replace; your call once it's in.

I can scaffold the `<Grovekeeper>` loader + reduced-motion fallback **now** (against the
default names above) so the asset is a one-file drop-in when it's ready — say the word.
