---
name: creature-engine
description: Rules and architecture for the Nibbin parametric SVG creature engine (v2). Use when creating, modifying, or rendering Nibbins/Grovekeeper sprites, species, stages, palettes, accessories (7: none/glasses/bow/pencil/broom/quill/coin — satchel & scarf retired for render quality; the Keeper's satchel is bespoke body art, not an accessory), markings, poses, or creature animations anywhere (app, chat, emails, marketing).
---
# Creature Engine v2

Reference implementation: `reference/nibbin-creature-lab.html`. Production home: `packages/creatures`. One engine renders everything — never fork per surface, never hand-draw.

## Character-design principles (why v2 looks designed)
- **Silhouette first:** every species must pass the solid-black test. Bodies are bezier masses (pear/bean/two-mass), never bare ellipses.
- **Shape language:** Sprout=pear (grounded, cheerful) · Wisp=teardrop w/ asymmetric trailing hem (serene, floats) · Shellback=loaf shell + head poking out front (wise, steady) · Longear=upright bean (plucky) · Puff=round w/ cheek-fluff outline breaks (chick) · Glim=two masses, head + glowing abdomen (gentle glowbug).
- **Asymmetry & gesture:** every species has a baked tilt (−3°..+3°), a leading foot, and one asymmetric signature (Longear's bent ear, Wisp's trailing hem curl, uneven Glim antennae, Puff cowlick).
- **Eye systems differ per species:** round (Sprout/Glim/Keeper), oval-calm (Wisp), tall-alert (Longear), bead+brow (Puff), small+wise brows (Shellback). Never reuse one eye kit across species.
- **Cel shading:** `mass(pathD,color,opts)` = gradient base + clipped offset shadow + highlight + outline (2px body / ~1.3px details). All new masses go through `mass()` — no flat-gradient-only shapes.
- Blush is always coral #E2603A by design, on every species. Unique gradient/clip IDs per render (engine handles via _uid).

## Growth traits (the trust UI — anatomy changes per stage)
Sprout: 1 leaf → 2 leaves → bloom. Wisp: calm hem/no arms → wavy hem + asymmetric arms; flame 1→3 tongues + grad aura. Shellback: smooth low shell → ring + scute plates + tail → second ring. Longear: one ear flopped → one up one half → both perked (always asymmetric angles). Puff: wing nub → folded wing w/ feather lines → open fingered wing; crest 1→3. Glim: ONE curled antenna → two uneven → glowing pair + abdomen aura.

## The Keeper (canonical brand mascot)
- One form, every account: fixed moss body, leaf mantle collar, head branch with honey bloom, moss chin tuft, staff with glowing honey lantern, seed satchel with star.
- `buildCreature({species:'Keeper'})` ignores stage/palette/accessory/marking — passing them must not change the render.
- Never: graduation cap, palette shift, redesign per surface. The Keeper is the company's Duo; consistency is the asset.

## Testing
Exhaustive render (species × stage × accessory × marking): no NaN/undefined, exactly one <svg>…</svg>. Keeper canonicality test: render with hostile args, assert moss/honey present and no user-palette mass fills. Visual diff the species×stage matrix.
