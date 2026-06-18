# Diagnosis Reveal Ceremony (Beat 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** When a diagnosis is viewed **for the first time**, it *arrives* rather than appears: the Grovekeeper presents with one line tying off the 14 days → the letter reveals → the `WorkflowMap` **grows in** (spokes draw, nodes ease/scale in, staggered) → stats + adopt recs follow. Returning visits and older diagnoses render statically. Reduced-motion → everything at once. The diagnosis data is never gated behind animation.

**Architecture:** A thin client wrapper `<RevealStage>` decides — on mount, from `localStorage` keyed by the diagnosis id + `prefers-reduced-motion` — whether to add a `.playing` class to a container around the (still server-rendered) reveal content. **Every** entrance animation is pure CSS scoped under `.playing` (so no class = at rest = static, and a returning user never re-watches). `WorkflowMap` stays a server component; its nodes/spokes get class hooks + a per-node `--i` index so the grow-in is CSS-only, triggered by the ancestor `.playing`. A small mount-gated `<RevealKeeper>` renders the presenting Grovekeeper (engine `buildCreature({species:'Keeper'})`, same hydration gate as `KeeperSprite`).

**Tech Stack:** Next.js 15 App Router (server + client components), `@nibbin/creatures` (`buildCreature`, `creatureCss` already global), CSS modules + design tokens.

**Gate-free:** touches only `apps/web/app/app/diagnosis/*` and `apps/web/components/*` — outside the CI sensitive-path regex. **No migration** (first-view state is `localStorage`). **Caveat to flag in the PR:** first-view is per-device; a brand-new device could replay once. A cross-device flag (a `diagnoses.first_viewed_at` column) is a deliberate follow-up, not in scope (it would be gated).

**Design contract (CE-P1..P5, §5/§8/§9):** restrained-warm, earned language, never gamified; the Keeper *presents*, it is not the subject. Animations short, one-shot, never looped, never blocking. Tokens-only; no raw hex (WorkflowMap already uses hex literals for SVG strokes — leave those, they pre-exist; do not add new ones in CSS). Copy is sentence case. CE11 (ceremony copy in `keeper/src/copy.ts`) is deferred — that file is gated; inline the one presenting line here with a `// CE11:` comment marking the future move.

## File structure
- **Create** `apps/web/app/app/diagnosis/RevealStage.tsx` — client wrapper; first-view + reduced-motion → `.playing`.
- **Create** `apps/web/app/app/diagnosis/RevealKeeper.tsx` — client, mount-gated presenting Grovekeeper + line.
- **Modify** `apps/web/app/app/diagnosis/DiagnosisReveal.tsx` — wrap content in `<RevealStage>`, add the Keeper opener + section class hooks.
- **Modify** `apps/web/app/app/diagnosis/WorkflowMap.tsx` — class hooks + `--i` on spokes/nodes (no behavior change when not `.playing`).
- **Modify** `apps/web/app/app/diagnosis/diagnosis.module.css` — `.playing` entrance keyframes + staggered delays + reduced-motion guard.
- **Modify** `apps/web/app/app/diagnosis/page.tsx` — pass `diagnosisId={newest.id}` to `<DiagnosisReveal>`.
- **Verify** the per-diagnosis detail route `apps/web/app/app/diagnosis/[id]/` renders `<DiagnosisReveal>` WITHOUT a `diagnosisId` (older maps never animate — §9).

---

### Task 1: `WorkflowMap` gets animation hooks (no behavior change at rest)

**Files:** Modify `apps/web/app/app/diagnosis/WorkflowMap.tsx`

- [ ] **Step 1** — give the spokes group a class and each spoke an index var. Replace the spokes block (lines 132-138) with:

```tsx
        {/* Faint hub spokes — "all one week", not a data relationship. */}
        {nodes.length > 1 && (
          <g className={styles.mapSpokes} fill="none" stroke={COLOR.line} strokeWidth="1.4">
            {nodes.slice(1).map((n, i) => (
              <line
                key={`spoke-${n.key}`}
                className={styles.mapSpoke}
                style={{ '--i': i } as React.CSSProperties}
                x1={hub.x}
                y1={hub.y}
                x2={n.x}
                y2={n.y}
              />
            ))}
          </g>
        )}
```

- [ ] **Step 2** — give each node `<g>` the index var (the class `styles.wfNode` already exists; add `--i` and a grow-in class). Replace the node-group opening (line 142) `<g key={n.key} className={styles.wfNode}>` with:

```tsx
            <g
              key={n.key}
              className={`${styles.wfNode} ${styles.mapNode}`}
              style={{ '--i': i } as React.CSSProperties}
            >
```

(The `.map(...)` callback already exposes the index — confirm it reads `nodes.map((n, i) =>`; if it currently reads `(n)`, add `, i`.)

- [ ] **Step 3** — `WorkflowMap` is a server component and `React.CSSProperties` is a type-only use; add `import type React from 'react';` at the top IF the file does not already have a React import (it likely does not). Verify with a typecheck.

- [ ] **Step 4** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): WorkflowMap animation hooks for the reveal grow-in`.

---

### Task 2: `RevealKeeper` — the presenting Grovekeeper

**Files:** Create `apps/web/app/app/diagnosis/RevealKeeper.tsx`

- [ ] **Step 1** — write it (mount-gate mirrors `grove/KeeperSprite.tsx` lines 79-83 so the engine's per-render gradient ids don't break hydration):

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildCreature } from '@nibbin/creatures';
import styles from './diagnosis.module.css';

/**
 * The Grovekeeper presenting the diagnosis (CE-P5 — the Keeper narrates these
 * moments, it is never the subject). Engine-only sprite, mount-gated for the
 * gradient-id hydration gotcha. Static pose — the ceremony's motion is the
 * staged reveal around it, not the sprite.
 */
export function RevealKeeper() {
  const keeperSvg = useMemo(() => buildCreature({ species: 'Keeper', size: 88 }), []);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className={styles.revealKeeper}>
      <div className={styles.revealKeeperSprite} aria-hidden="true">
        {mounted && <span dangerouslySetInnerHTML={{ __html: keeperSvg }} />}
      </div>
      {/* CE11: this line will move to keeper/src/copy.ts when that (gated) work lands. */}
      <p className={styles.revealKeeperLine}>
        Fourteen days, grown into one map. Here&rsquo;s where your week actually goes.
      </p>
    </div>
  );
}
```

- [ ] **Step 2** — note: `<span dangerouslySetInnerHTML>` on engine SVG will trip semgrep's `react-dangerouslysetinnerhtml` rule (SAST is diff-scoped). Add the suppression directly above the attribute, matching the repo convention (see `apps/web/components/adopt/AdoptHatch.tsx`):

```tsx
        {mounted && (
          <span
            // keeperSvg is built by the in-repo @nibbin/creatures engine from a
            // fixed species — never user/runtime HTML (same trust basis as
            // grove/KeeperSprite.tsx).
            // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml
            dangerouslySetInnerHTML={{ __html: keeperSvg }}
          />
        )}
```

- [ ] **Step 3** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): RevealKeeper — the presenting Grovekeeper for the diagnosis reveal`.

---

### Task 3: `RevealStage` — first-view gate

**Files:** Create `apps/web/app/app/diagnosis/RevealStage.tsx`

- [ ] **Step 1** — write it:

```tsx
'use client';

import { useEffect, useState } from 'react';
import styles from './diagnosis.module.css';

/**
 * Plays the reveal ceremony on the FIRST view of a diagnosis only (§5/§9).
 * "First view" is remembered per-device in localStorage keyed by the diagnosis
 * id; a returning user (or reduced-motion) gets the static reveal — the data is
 * identical, only the staged entrance differs (CE-P4, never gate the data).
 */
export function RevealStage({
  diagnosisId,
  children,
}: {
  diagnosisId: string;
  children: React.ReactNode;
}) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    // SSR + the first client render must agree (no class), so the decision is
    // made in an effect; the class is added one tick later. That tick is
    // invisible (the entrance animations start from the hidden/at-rest state).
    const key = `nibbin:reveal-seen:${diagnosisId}`;
    let seen = false;
    try {
      seen = window.localStorage.getItem(key) === '1';
    } catch {
      // storage blocked (private mode) — treat as seen, skip the show.
      seen = true;
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!seen && !reduced) {
      setPlaying(true);
      try {
        window.localStorage.setItem(key, '1');
      } catch {
        /* ignore */
      }
    }
  }, [diagnosisId]);

  return <div className={playing ? styles.playing : undefined}>{children}</div>;
}
```

- [ ] **Step 2** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): RevealStage — first-view-only gate for the reveal ceremony`.

---

### Task 4: Wire the reveal — Keeper opener, stage wrapper, section hooks

**Files:** Modify `apps/web/app/app/diagnosis/DiagnosisReveal.tsx`, `apps/web/app/app/diagnosis/page.tsx`

- [ ] **Step 1 — `DiagnosisReveal.tsx`** add imports (top, after existing imports):

```ts
import { RevealStage } from './RevealStage';
import { RevealKeeper } from './RevealKeeper';
```

- [ ] **Step 2** — extend the component signature to accept an optional `diagnosisId` (older-map detail route passes none → no animation). Change:

```tsx
export function DiagnosisReveal({
  map,
  letter,
  window,
}: {
  map: DiagnosisMap;
  letter: string | null;
  window?: { from: string; to: string };
}) {
```
to:
```tsx
export function DiagnosisReveal({
  map,
  letter,
  window,
  diagnosisId,
}: {
  map: DiagnosisMap;
  letter: string | null;
  window?: { from: string; to: string };
  diagnosisId?: string;
}) {
```

- [ ] **Step 3** — wrap the returned fragment. The current `return ( <> … </> )` becomes: when `diagnosisId` is present, wrap in `<RevealStage>` and prepend `<RevealKeeper>`; otherwise render the existing static fragment unchanged. Concretely, replace the opening `return (` + `<>` (lines 63-64) with:

```tsx
  const body = (
    <>
      {diagnosisId && (
        <div className={styles.revealSec} style={{ '--sec': 0 } as React.CSSProperties}>
          <RevealKeeper />
        </div>
      )}
```

and wrap each major section so the stagger has targets. The simplest faithful approach: tag the existing top-level blocks with `styles.revealSec` + an incrementing `--sec` index, in render order:
  - letter card → `--sec: 1`
  - `.total` → `--sec: 2`
  - `timeSaved` → `--sec: 3`
  - `.chipline` → `--sec: 4`
  - `<WorkflowMap>` (wrap it) → `--sec: 5`
  - everything after (allocation, "Where the hours go", recommendations) → `--sec: 6, 7, …`

For each, wrap or add the class. Example for the letter:
```tsx
      {letter && (
        <div className={styles.revealSec} style={{ '--sec': 1 } as React.CSSProperties}>
          <Card className={styles.letterCard}>
            <p className={styles.letterEyebrow}>A letter from the Grovekeeper</p>
            <p className={styles.letter}>{letter}</p>
          </Card>
        </div>
      )}
```
Apply the same wrapper pattern to `.total`, the `timeSaved` `<p>`, `.chipline`, the `<WorkflowMap>`, the allocation block, the "Where the hours go" list, and the recommendations block — each in its own `<div className={styles.revealSec} style={{ '--sec': N }}>` with N increasing. The WorkflowMap wrapper additionally gets `styles.revealMap` so its internal nodes/spokes animate (see Task 5 CSS).

- [ ] **Step 4** — close the body and return it wrapped or bare:

```tsx
    </>
  );

  return diagnosisId ? <RevealStage diagnosisId={diagnosisId}>{body}</RevealStage> : body;
}
```

- [ ] **Step 5 — `page.tsx`** pass the id (only the newest reveal animates). Change the `<DiagnosisReveal map={newestMap} letter={newest.letter} window={…} />` call to add `diagnosisId={newest.id}`.

- [ ] **Step 6** — confirm the per-diagnosis detail route does NOT pass `diagnosisId`. Read `apps/web/app/app/diagnosis/[id]/page.tsx` (or wherever `DiagnosisReveal` is also rendered). If it renders `<DiagnosisReveal>` it must omit `diagnosisId` so older maps stay static (§9). Leave it as-is if already omitted.

- [ ] **Step 7** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): diagnosis reveal — Keeper opener + staged first-view entrance`.

---

### Task 5: The choreography CSS

**Files:** Modify `apps/web/app/app/diagnosis/diagnosis.module.css`

- [ ] **Step 1** — append the ceremony styles. All entrance animation is scoped under `.playing`; without it, `.revealSec`/map nodes are at their natural resting state (no transform, full opacity). Use tokens for motion.

```css
/* ── Reveal ceremony (Beat 1) — all gated under .playing ─────────────── */
.revealKeeper {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
  margin: 4px 0 20px;
}
.revealKeeperSprite { line-height: 0; }
.revealKeeperSprite :global(svg) { display: block; }
.revealKeeperLine {
  font-family: var(--display);
  font-size: 16px;
  color: var(--ink);
  max-width: 30ch;
  margin: 0;
}

/* Section entrance: each .revealSec rises + fades, staggered by --sec. */
.playing .revealSec {
  opacity: 0;
  animation: reveal-rise var(--dur-3) var(--ease-settle) forwards;
  animation-delay: calc(var(--sec, 0) * 140ms);
}
@keyframes reveal-rise {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}

/* The map "grows in": spokes draw, nodes scale up from their center, each
   staggered by --i, and only after the map section itself has arrived. */
.playing .revealMap .mapSpoke {
  opacity: 0;
  animation: reveal-spoke var(--dur-3) var(--ease-settle) forwards;
  animation-delay: calc(700ms + var(--i, 0) * 60ms);
}
@keyframes reveal-spoke {
  from { opacity: 0; }
  to { opacity: 1; }
}
.playing .revealMap .mapNode {
  opacity: 0;
  transform-box: fill-box;
  transform-origin: center;
  animation: reveal-node var(--dur-3) var(--ease-pop) forwards;
  animation-delay: calc(800ms + var(--i, 0) * 80ms);
}
@keyframes reveal-node {
  from { opacity: 0; transform: scale(0.4); }
  to { opacity: 1; transform: scale(1); }
}

/* Belt-and-suspenders: even if .playing is somehow present, honor the OS
   preference (the client also gates on it, so this is the static fallback). */
@media (prefers-reduced-motion: reduce) {
  .playing .revealSec,
  .playing .revealMap .mapSpoke,
  .playing .revealMap .mapNode {
    animation: none;
    opacity: 1;
    transform: none;
  }
}
```

- [ ] **Step 2** — verify `--dur-3`, `--ease-settle`, `--ease-pop`, `--display`, `--ink` are all defined in `packages/shared/tokens.css` (they are). No raw hex added.

- [ ] **Step 3** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0 (CSS module class refs resolve). Commit: `feat(web): reveal ceremony choreography — staged sections + map grow-in`.

---

### Task 6: Verify

- [ ] **Step 1** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0.
- [ ] **Step 2** — `cd /c/Nibbin && grep -rnE "#[0-9A-Fa-f]{6}" apps/web/app/app/diagnosis/diagnosis.module.css` → no NEW hex from this work (pre-existing entries, if any, are out of scope; the appended ceremony block must add none).
- [ ] **Step 3** — confirm both `dangerouslySetInnerHTML` (RevealKeeper) carry the `nosemgrep` suppression: `grep -n "nosemgrep" apps/web/app/app/diagnosis/RevealKeeper.tsx` → 1 line.
- [ ] **Step 4** — sanity: `grep -rn "diagnosisId" apps/web/app/app/diagnosis/` → present in `page.tsx` (newest only), `DiagnosisReveal.tsx`, `RevealStage.tsx`; ABSENT in `[id]/` detail route.

## Self-review
- **Gate-free:** no migration, no sensitive path. localStorage for first-view (per-device caveat flagged for the PR).
- **Spec coverage (§5):** Keeper presents (RevealKeeper) → letter (`--sec:1`) → map grows in (`.revealMap` nodes/spokes) → stats + recs follow (later `--sec`). First-view-only (RevealStage + localStorage); older maps + detail route static (no `diagnosisId`); reduced-motion static (client gate + CSS `@media`); no-letter fallback works (the `{letter && …}` block just doesn't render — the Keeper line still frames the map). Data never gated (content is always in the DOM; `.playing` only animates opacity/transform).
- **Design (CE-P1..P5):** Keeper presents (not subject); restrained-warm (rise + scale, no confetti); earned/sentence-case copy; tokens-only motion; engine-only sprite with the hydration mount-gate + nosemgrep suppression matching the AdoptHatch precedent.
- **Type consistency:** `diagnosisId?: string` threads page → DiagnosisReveal → RevealStage; `--sec`/`--i` are CSS custom props set via `style` with the `as React.CSSProperties` cast already used elsewhere in this codebase.
