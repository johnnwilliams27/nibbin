# Ceremony & Reveal — Design Spec

**Date:** 2026-06-17
**Status:** Draft for review (design-only; mostly *staging existing pieces*, not new infrastructure)
**Scope:** The emotional layer over the moments that today land as **plain data or a plain feed-leaf, with no in-context moment** — the diagnosis **reveal**, the **adopt → hatch** ("your agent is being born"), and **graduation** (earned, not unlocked). (Graduation/evolution already produce a notifications "leaf" + email beat — see §4; the gap is the *ceremonial* treatment, not the existence of a notification.) It does **not** build new animation/creature tech; it routes the choreography that **already exists** (the hatch crack→emerge→leaf-burst, the Keeper expression system, the celebration cards, the warm Keeper voice) into the three milestone beats that today land as plain data or happen off-screen.

> **Grounded against current `origin/main`** (post the creature-restyle / configurator / connections / NIB-4 merges). File refs below are to that code.

**Companion specs:**
- **Agent Synthesis** (`2026-06-17-agent-synthesis-design.md`) — named this as the companion that "wraps [synthesis] with the emotional 'your agent is being born' layer once its shape is final." Graduation here is the UX skin over **Agent School** (Egg→Student→Senior→Graduate, `packages/runtime/src/school.ts`) — this spec celebrates the promotion, it does not change the promotion bar.
- **Capture bring-up** — the reveal is the *end* of the 14-day study arc this ceremony closes.

---

## 1. Goals & non-goals

**Goal:** Make the three earned moments *feel* earned — a diagnosis that arrives rather than appears, a first agent that is visibly *born*, and a graduation the user actually witnesses — in the restrained, warm register the product already speaks in ("grown into one map", "carved on the lantern", "back to drafts — good instinct"), never gamified.

**Non-goals:** new creature art or animation tech (it exists); changing Agent School's promotion math (that's AS §18.1 / `school.ts`); the diagnosis *data* layer (workflow map, time-saved, letter — all built); confetti/XP/"level up" theatrics (off-brand); blocking data behind animation (the reveal is paced, never gated).

---

## 2. Principles

- **CE-P1 — Earned, not unlocked.** Every beat uses the brand's earned language ("you approved her there", "she's Senior now") — never "level up / unlocked / +1". Mirrors the brand-voice rule and the configurator's own *"Stage — earned, not chosen"*.
- **CE-P2 — Restrained-warm.** Match the register that already exists (leaf-burst + 'delighted' + a one-line celebration card), not more. The ceremony is a held breath, not fireworks.
- **CE-P3 — Reuse, don't reinvent.** The hatch choreography, Keeper expressions, leaf-burst, creature engine, and celebration-card primitive already exist (§4). The work is *routing* them into moments, plus one reusable extraction.
- **CE-P4 — Never gate the data.** The diagnosis content is always immediately reachable; pacing/animation is an overlay that respects `prefers-reduced-motion` and is skippable. A returning user doesn't re-watch the show.
- **CE-P5 — The Keeper presents, the Nibbins are born.** The Grovekeeper (C10, no hands) is the *narrator* of these moments; the adopted Nibbin is the *subject* of the hatch. Keep that role split.

---

## 3. Architecture — ceremony is a set of earned moments, one shared kit

Not one event — **three beats** that share a small **ceremony kit** (§4):

| Beat | Today | This spec |
|---|---|---|
| **Reveal** (`/app/diagnosis`) | Letter buried in a card + stats + map + adopt buttons; no pacing, no Keeper presence | Paced arrival: Keeper presents → letter → map "grows in"; first-view only |
| **Adopt → hatch** | Adopt → redirect to `/app`; the egg-crack/emerge happens in the grove **background**, often unseen | Surface the *existing* hatch choreography at the moment of adoption; the **first** adoption is the hero "your first agent is being born" beat |
| **Graduation** | School promotion **already lands a text leaf** in `/app/notifications` ("Leaves") + a drip email beat — but the roster stage flips with **no in-context moment** (no creature-at-new-stage, no Keeper beat) | Enrich the *existing* leaf + add the in-context celebration; the "earned" moment, today just a feed line |

(Plus the **dignified-demotion** echo — "back to drafts, good instinct" — already a brand-voice line; this spec gives it the same calm card treatment as graduation's inverse.)

---

## 4. The ceremony kit (already exists — reuse)

- **Hatch choreography** — egg wobble → crack (`grove.module.css` `grove-crack`) → emerge at ~2.1s → `'delighted'` expression + **leaf-burst** (`apps/web/app/app/grove/KeeperChat.tsx:142-155`). **Currently inlined in KeeperChat for onboarding only.** Build task: **extract into a reusable `<Hatch>` component** (egg → species creature, with the same timing + leaf-burst) usable at adoption and graduation, not just first onboarding.
- **Keeper sprite + expression system** — `KeeperSprite.tsx`: idle/listening/thinking/concerned/**presenting**/**delighted**; leaf-burst on delighted. Reused for the reveal (presenting) and graduations (delighted).
- **Creature engine** — `packages/creatures` `buildCreature({species, stage, color, acc, mark})`, per-species cells, stage art incl. the grad cap. Renders the subject Nibbin at its new stage.
- **Celebration-card primitive** — the `kind:'celebration'` message card (`packages/keeper/src/onboarding.ts` naming-ack uses it). Reused for graduation.
- **Keeper voice/copy** — `packages/keeper/src/copy.ts` (`HATCH`, `ASK_KEEPER_NAME.ack`, `DONE`, `NEXT_STEP`). New ceremony lines live here, same register.
- **The diagnosis data** — `DiagnosisReveal.tsx` (letter, stats, `WorkflowMap`, adopt recs), letter synthesized in the Keeper's voice (`llm/synthesis`). The reveal *paces* this; it doesn't rebuild it.
- **The notifications "leaves" feed (exists — the global surface)** — `apps/web/app/app/notifications/page.tsx` ("Your leaves" / "From the grove"), with the **"Leaves"** entry in `AppShell`. It already collects every drip beat **and** every earned **evolution/graduation** leaf (`mark_notification_read` is the single client write path; the drip/School pipeline writes the `graduation`/`evolution` rows). **Ceremony beats integrate with this feed (enrich the existing leaf), never add a parallel notification path.** Gap to close (CE12): the "Leaves" nav entry has **no unread indicator** today, so leaves land unseen — an unread badge on the nav is the cheap discoverability fix that makes every ceremony leaf actually get noticed.

---

## 5. Beat 1 — The Reveal (`/app/diagnosis`, first view)

When a diagnosis is viewed **for the first time** (per-diagnosis flag), arrive rather than appear:
1. **Keeper presents** — the Grovekeeper sprite (presenting expression) opens with one line tying off the 14 days (e.g. *"Fourteen days, grown into one map. Here's where your week actually goes."* — echoes the existing day-14 email beat).
2. **Letter** — the Grovekeeper's letter reveals as *its* message (lifted out of the buried card into the Keeper's voice), then…
3. **Map grows in** — the existing deterministic `WorkflowMap` SVG **staggers/grows** (nodes + spokes ease in; the brand's "grown into one map" made literal), settling on the biggest-friction hotspot. Stats + adopt recs follow.
4. **Hand-off to action** — the adopt recommendations are the bridge to Beat 2 ("Ready to take the first slices" → adopting the first Nibbin *is* the next ceremony).

Rules: **first-view only** (subsequent visits + older diagnoses render statically — CE-P4); `prefers-reduced-motion` → everything appears at once, Keeper static-delighted, copy intact; **no-letter fallback** → skip step 2, Keeper's presenting line still frames the map.

## 6. Beat 2 — Adopt → Hatch ("your agent is being born")

Today adoption (`lib/runtime/adopt.ts` → egg/`hatchToStudent` §4.6 → first-run §4.1) redirects to `/app` and the hatch happens off-screen. Make it seen:
- On adopt, show the **`<Hatch>`** moment for the new Nibbin — its egg (species-colored) cracks and the creature emerges with the leaf-burst, the Keeper narrating ("Meet {name}. She'll start in drafts, for your approval, until she earns more." — earned language, sets the School expectation).
- **First adoption is the hero beat** — extra weight + a one-time line ("Your first helper. This is the part I've been waiting for." — reuses the HATCH greeting register). Subsequent adoptions: the same hatch, lighter framing.
- **The first draft is the payoff** — the existing first-run dispatch means a reviewable draft lands within minutes; the ceremony points at it ("She's already drafting — I'll bring it to you to approve."). The birth → first work → your approval is the arc.
- **Missing-connector path is honest** — if adoption defers to `/app/connections?resume=…`, the hatch fires **after** the connection completes the adoption, not before (never hatch a Nibbin that can't yet run; no fake birth).

## 7. Beat 3 — Graduation (earned, not unlocked)

When Agent School promotes (`school.ts` `promotionCheck` → Student→Senior→Grad), an **evolution/graduation leaf already lands** in `/app/notifications` (and a drip email beat fires) — so this is **not silent**. What's missing is the **in-context ceremonial treatment**: the leaf is a plain title+body, and the roster stage flips with no creature/Keeper moment. The work:
- **Enrich the existing leaf** (don't add a parallel path — it already lands): render the Nibbin at its **new stage** (Senior markings / the grad cap) on the leaf, in the Keeper's voice.
- **Add the in-context moment** when the user is in-app (grove/roster): the creature re-renders at its new stage with the Keeper delighted + leaf-burst — the moment the leaf currently only *describes*.
- **Earned copy, with the why:** *"{name} is Senior now — you approved her enough that she can send routine work herself. You're still in the loop for anything new."* (the *new autonomy* + the residual control — trust framing, not a trophy).
- **The inverse (dignified demotion)** gets the same calm leaf + card: *"{name} is back to drafts — good instinct catching that."* (CE-P1; brand-voice's dignified-demotion line).

## 8. Accessibility & restraint (CE-P2/P4)
`prefers-reduced-motion` → no animation anywhere; content + static creatures + copy carry every beat (the moments still *read* as moments via copy + the creature at its stage). Animations are short (the hatch is ~2.1s, proven), one-shot, never looped, never blocking. No sound. The data/diagnosis is always reachable without watching anything.

## 9. Unhappy paths
Returning user / already-seen diagnosis → static, no replay (CE-P4). • Older diagnosis in history → no ceremony (only the newest, first-viewed). • No letter → Keeper's presenting line still frames it. • Adoption blocked on connectors → hatch deferred until connected (no fake birth). • Reduced-motion → instant + copy. • Promotion + demotion in quick succession → coalesce to the latest state, one card. • Multiple adoptions in a session → first is hero, rest are warm-light. • Creature engine/asset failure → fall back to copy-only celebration (never a broken animation as the "moment").

## 10. Requirements coverage ledger
| # | Requirement | Section | Reuses |
|---|---|---|---|
| CE1 | Extract the hatch choreography into a reusable `<Hatch>` component (egg→creature + leaf-burst, ~2.1s) | §4, §6 | KeeperChat hatch, creatures engine |
| CE2 | Reveal beat: paced first-view arrival (Keeper presents → letter → map grows in); first-view-only; data never gated | §5 | DiagnosisReveal, WorkflowMap, KeeperSprite |
| CE3 | Adopt→hatch beat: surface the hatch at adoption; first adoption = hero "agent born"; point at the first draft | §6 | adopt.ts, `<Hatch>`, Keeper voice |
| CE4 | Graduation beat: ENRICH the existing evolution/graduation notification leaf (it already lands) with new-stage creature + Keeper voice, AND add the in-context moment; earned copy. No parallel notification path | §7, §4 | notifications page, school.ts, drip leaf, celebration card |
| CE5 | Dignified-demotion echo (calm card, "good instinct") | §7 | brand voice |
| CE6 | Earned-not-unlocked language throughout (CE-P1) | §2 | brand-voice rules |
| CE7 | Restrained-warm register; no gamification (CE-P2) | §2 | existing leaf-burst/'delighted' |
| CE8 | `prefers-reduced-motion` + skippable + data-never-gated (CE-P4) | §8 | — |
| CE9 | Keeper presents / Nibbin is born role split (CE-P5) | §2, §6 | C10 |
| CE10 | Unhappy/edge paths first-class | §9 | — |
| CE12 | Unread indicator on the "Leaves" nav (AppShell) so ceremony leaves get noticed — discoverability fix | §4 | AppShell, notifications |
| CE11 | New ceremony copy lives in `keeper/src/copy.ts`, same voice | §4, §5–7 | copy.ts |

**Deferred-with-reason:** sound design; bespoke per-species hatch variations (one shared `<Hatch>` first); a "grove anniversary"/longer-term milestone system (separate, later).

## 11. Decisions (resolved 2026-06-17)
- **CE-D1 — DECIDED: restrained-warm register** — reuse the existing leaf-burst / 'delighted' / one-line-celebration vocabulary; no confetti, XP, or "level up". The held breath, not fireworks.
- **CE-D2 — DECIDED: the *set* of earned moments** (reveal + adopt/hatch + graduation, plus the demotion echo), sharing one ceremony kit — not a single reveal event. Graduation is the cheapest, highest-emotional win and is currently fully invisible.
- **CE-D3 — DECIDED: light Keeper presence on the reveal** — the Keeper *presents* the diagnosis (its voice already writes the letter); the reveal is not a creature-free data page.
- **CE-D4 — DECIDED: first-agent is the hero beat** — the first hatch gets extra weight + a one-time line; subsequent adoptions reuse the same hatch, lighter framing.

## 12. Relationship to current code (reuse map)
- `apps/web/app/app/grove/KeeperChat.tsx` (hatch timing) → extract `<Hatch>` (CE1).
- `apps/web/app/app/grove/KeeperSprite.tsx` + `grove.module.css` + `packages/creatures/src/css.ts` → expressions + crack/idle animations.
- `packages/creatures` (`buildCreature`, cells, stages incl. grad cap) → the subject creature at each stage.
- `apps/web/app/app/diagnosis/DiagnosisReveal.tsx` + `WorkflowMap` → the reveal surface to pace.
- `apps/web/lib/runtime/adopt.ts` (egg/`hatchToStudent`/first-run) → the adopt→hatch hook point.
- `packages/runtime/src/school.ts` (`promotionCheck`, stages) → the graduation trigger to celebrate.
- `packages/keeper/src/copy.ts` (`HATCH`/`ASK_KEEPER_NAME`/`DONE`/`NEXT_STEP`) → home for new ceremony copy, same register.
