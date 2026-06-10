---
name: design-system
description: Nibbin visual design tokens and rules - colors, typography, spacing, motion, components, accessibility. Use for ANY UI work, styling, CSS, emails, or visual output across web, desktop, and marketing.
---
# Design System

Source of truth: `reference/nibbin-style-guide.html` (the Field Guide). Canonical tokens belong in `packages/shared/tokens.css` — any hardcoded value not in the token sheet is a PR comment.

## The contract
- Surfaces: canopy #FFFFFF (cards) · paper #F5F6F2 (page) · understory #EAEDE3 (recessed) · shell #FBF6E6 (ceremonial/email only).
- Ink: #23291A text · #5A6248 secondary · #8A917B decorative-only (never body).
- Tints are backgrounds, bases are fills, **deeps are the only text-safe colors**: moss-deep #44601F, teal #2E5F58, honey #8A5F0C (NOT #9A6B0F — failed AA at 4.31:1), coral #B14A22, plum #5C3FB0, sky #36619F, rose #A23E66, slate #4E5447. Leaf #9CC25B is never text on light (text-legal only on dusk).
- Type: Bricolage Grotesque 700/800 = display (H1/H2/ceremony only) · Archivo = UI/body · IBM Plex Mono = labels (10-11px, uppercase, .10-.14em tracking) and data.
- Motion: durations 160/250/350/650ms; easings settle cubic-bezier(.16,1,.3,1), pop cubic-bezier(.34,1.45,.64,1) (one celebration per moment), glide ease-in-out (ambient only). Animate transform/opacity only. Every animation must be describable with a growth verb. Reduced-motion = full feature parity.
- Shape: radius 4 buttons / 6 inputs / 10 cards / 12 shells / 20 pills. Shadows ink-tinted rgba(35,41,26,...), 3 tiers, shadow-3 once per view.
- Icons: Lucide only, 1.5px stroke, 16/20/24 sizes. No emoji in UI chrome.
- Stage pills (load-bearing trust UI, never restyle locally): egg parchment, student moss-tint, senior honey-tint + #8A5F0C text, graduate solid moss/white.
- Focus: 2px moss outline, 2px offset, never removed. Touch targets >=44px on mobile.
- Creatures: engine-only, unique gradient IDs, idle animation always on (reduced-motion: static but visible), no graduation cap on the Keeper, clear space >= half creature width.
- Capitalization: sentence case everywhere; chips/status callouts capitalize first word ("Waiting on you"); mono labels are the only uppercase.
- Dusk theme (chat scene/evening): bg #222B1B, card #2C3622, text #E8ECDD, secondary #B7C0A6.
