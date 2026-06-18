# Adopt → Hatch Ceremony (Beat 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** When someone adopts a Nibbin (from the diagnosis reveal or the shop), a **focused hatch overlay** plays on the current page — a generic egg cracks, the adopted creature emerges (rendered by the engine at its real stage/palette/accessory/marking), a leaf burst celebrates, and earned Keeper copy frames it. The **first adoption** gets a fuller hero treatment; later adoptions a lighter one. Dismissing the overlay navigates into the grove.

**Architecture:** The adopt server actions stop redirecting on success and instead **return a serializable `AdoptOutcome`** (creature appearance + first-adoption flag + where to go next), still redirecting/pushing only for the error / missing-connector / limit paths. A small client `<AdoptButton>` invokes the action inside a transition, and on success renders the `<AdoptHatch>` overlay (reusing the grove's egg-crack / hop / leaf-burst choreography verbatim) before navigating. **Gate-free**: touches `apps/web/lib/runtime/adopt.ts`, `apps/web/app/app/diagnosis/*`, `apps/web/app/app/shop/*`, `apps/web/components/adopt/*` — none in the CI sensitive-path regex (`packages/runtime/` is gated, `apps/web/lib/runtime` is NOT; `apps/web/app/app/*` is NOT, only `apps/web/app/api/` is). No migration, no `packages/keeper`.

**Tech Stack:** Next.js 15 App Router, React client components, `@nibbin/creatures` engine (`buildCreature`, `creatureCss` already injected globally in `app/layout.tsx`), CSS modules + design tokens (`packages/shared/tokens.css`).

**Design contract:**
- Overlay is a centered modal over a dimmed backdrop ("focused overlay on the current page"), tokens-only, radii `--r-shell`, `--shadow-3`, `--ease-pop`/`--ease-settle` motion. Brand voice: sentence case, earned-not-unlocked. Creature rendered like the roster (`buildCreature` + `dangerouslySetInnerHTML`).
- Choreography mirrors the grove hatch (`apps/web/app/app/grove/grove.module.css` `grove-crack` 140ms×4, `grove-hop`, `grove-burst`; reduced-motion → static reveal, no crack/burst).
- First adoption (`isFirstAdoption`): larger creature (~132px), title "Meet {name} — your first Nibbin", body explaining it starts small and drafts only for approval until it earns more. Later adoptions: ~104px, "{name} hatched", one earned line.
- Earned copy never promises autonomy: drafts-for-approval framing only (consistent with C10 "Grovekeeper no hands").

## File structure
- **Modify** `apps/web/lib/runtime/adopt.ts` — extend `AdoptResult` with appearance + `isFirstAdoption`; populate on every return path; count existing Nibbins before the RPC.
- **Create** `apps/web/components/adopt/types.ts` — the client-safe `AdoptOutcome` discriminated union (no `server-only`).
- **Create** `apps/web/components/adopt/AdoptHatch.tsx` — the overlay (client).
- **Create** `apps/web/components/adopt/adopt-hatch.module.css` — overlay + choreography styles.
- **Create** `apps/web/components/adopt/AdoptButton.tsx` — client button that calls a passed action, manages the overlay + navigation.
- **Modify** `apps/web/app/app/diagnosis/actions.ts` — add `adoptRecommendationOutcome(templateKey): Promise<AdoptOutcome>` (keep `deleteDiagnosis` untouched; remove the old `adoptRecommendation`).
- **Modify** `apps/web/app/app/diagnosis/DiagnosisReveal.tsx` — render `<AdoptButton>` instead of the `<form>`.
- **Modify** `apps/web/app/app/shop/actions.ts` — replace `adoptFromShopAction` with `adoptFromShopOutcome(templateKey): Promise<AdoptOutcome>`.
- **Modify** `apps/web/app/app/shop/page.tsx` — render `<AdoptButton>` instead of the `<form>`.

---

### Task 1: Runtime — appearance + first-adoption flag on `AdoptResult`

**Files:**
- Modify: `apps/web/lib/runtime/adopt.ts`

- [ ] **Step 1 — extend the `AdoptResult` interface** (lines 20-28). Replace it with:

```ts
export interface AdoptResult {
  nibbinId: string;
  name: string;
  templateKey: string;
  stage: 'egg' | 'student';
  /** Outcome of the first dispatched run (§4.1 step 7 — first value fast). */
  firstRun: RunOutcome | null;
  missingConnectors: string[];
  /** Creature appearance for the hatch ceremony (resolved template ∪ override). */
  species: string;
  palette: string;
  accessory: string;
  marking: string;
  /** True when this is the account's first non-sleeping Nibbin (hero ceremony). */
  isFirstAdoption: boolean;
}
```

- [ ] **Step 2 — count existing Nibbins before the RPC.** Right after `const connections = await activeConnections(svc, accountId);` (line 71) and before the `missing` computation, add:

```ts
  // §4.1: the hero hatch only plays for the account's FIRST Nibbin. Count
  // non-sleeping Nibbins BEFORE we write the new one.
  const { count: existingCount, error: countErr } = await svc
    .from('nibbins')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .neq('status', 'sleeping');
  if (countErr) throw new Error(`nibbin count failed: ${countErr.message}`);
  const isFirstAdoption = (existingCount ?? 0) === 0;
```

- [ ] **Step 3 — populate appearance on the missing-connectors return** (the early return at lines 74-83). Replace that return with:

```ts
  if (missing.length > 0) {
    return {
      nibbinId: '',
      name,
      templateKey,
      stage: 'egg',
      firstRun: null,
      missingConnectors: missing,
      species,
      palette,
      accessory,
      marking,
      isFirstAdoption,
    };
  }
```

- [ ] **Step 4 — populate appearance on the success return** (the final `return` at line 126). Replace with:

```ts
  return {
    nibbinId,
    name,
    templateKey,
    stage: hatched ? 'student' : 'egg',
    firstRun,
    missingConnectors: [],
    species,
    palette,
    accessory,
    marking,
    isFirstAdoption,
  };
```

- [ ] **Step 5 — typecheck.** Run: `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. (If other callers of `adoptTemplate` destructure `AdoptResult` and now miss fields, the compiler will flag them — none are expected since fields were only added, all optional at call sites.)

- [ ] **Step 6 — commit.**

```bash
cd /c/Nibbin && git add apps/web/lib/runtime/adopt.ts
git commit -m "feat(web): adoptTemplate returns creature appearance + first-adoption flag"
```

---

### Task 2: The shared `AdoptOutcome` type

**Files:**
- Create: `apps/web/components/adopt/types.ts`

- [ ] **Step 1 — write the client-safe outcome type** (no `server-only` so both the server actions and the client overlay can import it):

```ts
/**
 * The serializable result of an adopt server action. On success we carry the
 * creature's appearance so the client can play the hatch ceremony; on any
 * non-success path we carry where the client should navigate instead.
 */
export type AdoptOutcome =
  | {
      ok: true;
      nibbinId: string;
      name: string;
      species: string;
      stage: 'egg' | 'student';
      palette: string;
      accessory: string;
      marking: string;
      isFirstAdoption: boolean;
      /** Where "meet them" goes after the ceremony. */
      ctaPath: string;
    }
  | { ok: false; redirectTo: string };
```

- [ ] **Step 2 — typecheck.** Run: `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0.

- [ ] **Step 3 — commit.**

```bash
cd /c/Nibbin && git add apps/web/components/adopt/types.ts
git commit -m "feat(web): AdoptOutcome type for the hatch ceremony"
```

---

### Task 3: The `<AdoptHatch>` overlay component

**Files:**
- Create: `apps/web/components/adopt/AdoptHatch.tsx`
- Create: `apps/web/components/adopt/adopt-hatch.module.css`

- [ ] **Step 1 — write `adopt-hatch.module.css`** (choreography copied from `grove.module.css`; tokens-only):

```css
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(35, 41, 26, 0.44);
  animation: ah-fade var(--dur-2) var(--ease-settle) 1;
}

.card {
  background: var(--canopy);
  border: 1px solid var(--line);
  border-radius: var(--r-shell);
  box-shadow: var(--shadow-3);
  padding: 32px 28px 24px;
  max-width: 380px;
  width: 100%;
  text-align: center;
  animation: ah-rise var(--dur-3) var(--ease-pop) 1;
}

.spot {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 148px;
  margin-bottom: 8px;
}

.creature {
  line-height: 0;
}

.creature :global(svg) {
  display: block;
}

.emerge {
  animation: grove-hop var(--dur-4) var(--ease-pop) 1;
}

.egg {
  padding-bottom: 14px;
}

.eggCracking {
  animation: grove-crack 140ms linear 4;
  transform-origin: 50% 85%;
}

.title {
  font-family: var(--display);
  font-weight: 700;
  font-size: 19px;
  color: var(--ink);
  margin: 4px 0 0;
}

.body {
  font-size: 14px;
  line-height: 1.55;
  color: var(--ink-soft);
  margin: 8px 0 20px;
}

.cta {
  width: 100%;
}

/* leaf burst — one celebration per hatch */
.burst {
  position: absolute;
  left: 50%;
  top: 38%;
  pointer-events: none;
}

.burstLeaf {
  position: absolute;
  opacity: 0;
  animation: grove-burst var(--dur-4) var(--ease-settle) var(--delay, 0ms) 1 forwards;
}

@keyframes ah-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes ah-rise {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes grove-hop {
  0%, 100% { transform: translateY(0); }
  40% { transform: translateY(-14px); }
  70% { transform: translateY(-2px); }
}

@keyframes grove-crack {
  0%, 100% { transform: rotate(0); }
  25% { transform: rotate(-5deg); }
  75% { transform: rotate(5deg); }
}

@keyframes grove-burst {
  0% { opacity: 0; transform: translate(0, 0) rotate(0); }
  15% { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); }
}

@media (prefers-reduced-motion: reduce) {
  .backdrop,
  .card,
  .emerge,
  .eggCracking,
  .burstLeaf {
    animation: none !important;
  }
  .burstLeaf {
    display: none;
  }
}
```

- [ ] **Step 2 — write `AdoptHatch.tsx`** (client). It owns the egg → crack → reveal timeline (mirroring `KeeperChat` lines 134-155), renders the engine egg then the real creature, and calls `onDismiss` from the CTA:

```tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildCreature,
  type Accessory,
  type Marking,
  type SpeciesName,
  type Stage,
} from '@nibbin/creatures';
import { Button } from '../ui';
import styles from './adopt-hatch.module.css';

const BURST = [
  { dx: '-46px', dy: '-38px', rot: '-80deg' },
  { dx: '-26px', dy: '-58px', rot: '-30deg' },
  { dx: '4px', dy: '-64px', rot: '15deg' },
  { dx: '30px', dy: '-54px', rot: '50deg' },
  { dx: '48px', dy: '-32px', rot: '95deg' },
  { dx: '-52px', dy: '-12px', rot: '-120deg' },
];

export interface AdoptHatchProps {
  name: string;
  species: string;
  stage: 'egg' | 'student';
  palette: string;
  accessory: string;
  marking: string;
  isFirstAdoption: boolean;
  onDismiss: () => void;
}

export function AdoptHatch({
  name,
  species,
  stage,
  palette,
  accessory,
  marking,
  isFirstAdoption,
  onDismiss,
}: AdoptHatchProps) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hatched, setHatched] = useState(false);
  const [cracking, setCracking] = useState(false);
  const timers = useRef<number[]>([]);

  // A generic egg (matches the grove hatch); the real creature emerges from it.
  const size = isFirstAdoption ? 132 : 104;
  const eggSvg = useMemo(() => buildCreature({ species: 'Sprout', stage: 'egg', size: 112 }), []);
  const creatureSvg = useMemo(
    () =>
      buildCreature({
        species: species as SpeciesName,
        stage: stage as Stage,
        color: palette,
        acc: accessory as Accessory,
        mark: marking as Marking,
        size,
      }),
    [species, stage, palette, accessory, marking, size],
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
  }, []);

  // Egg cracks, then the adopted creature emerges (instant under reduced motion).
  useEffect(() => {
    if (reducedMotion) {
      setHatched(true);
      return;
    }
    const t1 = window.setTimeout(() => setCracking(true), 900);
    const t2 = window.setTimeout(() => setHatched(true), 1500);
    timers.current.push(t1, t2);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [reducedMotion]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const title = isFirstAdoption ? `Meet ${name} — your first Nibbin` : `${name} hatched`;
  const body = isFirstAdoption
    ? `${name} starts small and only ever drafts for your approval — they earn more as you confirm their work. Come say hello.`
    : `${name} is in your grove now, drafting for your approval. They earn more as they get it right.`;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={title}>
      <div className={styles.card}>
        <div className={styles.spot}>
          {!hatched ? (
            <div
              className={cracking ? `${styles.egg} ${styles.eggCracking}` : styles.egg}
              role="img"
              aria-label="An egg, about to hatch"
              dangerouslySetInnerHTML={{ __html: eggSvg }}
            />
          ) : (
            <>
              <div
                className={`${styles.creature}${reducedMotion ? '' : ` ${styles.emerge}`}`}
                role="img"
                aria-label={`${name}, your new Nibbin`}
                dangerouslySetInnerHTML={{ __html: creatureSvg }}
              />
              {!reducedMotion && (
                <span className={styles.burst} aria-hidden="true">
                  {BURST.map((l, i) => (
                    <svg
                      key={i}
                      className={styles.burstLeaf}
                      style={
                        { '--dx': l.dx, '--dy': l.dy, '--rot': l.rot, '--delay': `${i * 40}ms` } as React.CSSProperties
                      }
                      viewBox="0 0 12 12"
                      width="12"
                      height="12"
                    >
                      <path d="M6 1 C10 3 10 8 6 11 C2 8 2 3 6 1 Z" fill="var(--leaf)" stroke="var(--moss)" strokeWidth="0.6" />
                    </svg>
                  ))}
                </span>
              )}
            </>
          )}
        </div>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.body}>{body}</p>
        <Button type="button" variant="primary" className={styles.cta} onClick={onDismiss}>
          Meet {name}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3 — confirm `Button` accepts `className` + `onClick`.** Read `apps/web/components/ui/Button.tsx`; if it forwards arbitrary props (`...rest`) onto the `<button>`, no change is needed. If it does NOT accept `className`/`onClick`, fall back to a plain `<button className={styles.cta}>` styled to match (mono uppercase is NOT wanted here — primary pill). Prefer reusing `Button`.

- [ ] **Step 4 — typecheck.** Run: `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0.

- [ ] **Step 5 — commit.**

```bash
cd /c/Nibbin && git add apps/web/components/adopt/AdoptHatch.tsx apps/web/components/adopt/adopt-hatch.module.css
git commit -m "feat(web): AdoptHatch overlay — egg cracks, the adopted Nibbin emerges"
```

---

### Task 4: The `<AdoptButton>` client wrapper

**Files:**
- Create: `apps/web/components/adopt/AdoptButton.tsx`

- [ ] **Step 1 — write `AdoptButton.tsx`** (client). It receives a server action (`(templateKey: string) => Promise<AdoptOutcome>`) as a prop, runs it in a transition, then either navigates (failure path) or shows `<AdoptHatch>` (success). The CTA dismiss navigates to `ctaPath`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui';
import { AdoptHatch } from './AdoptHatch';
import type { AdoptOutcome } from './types';

type Appearance = Extract<AdoptOutcome, { ok: true }>;

export function AdoptButton({
  action,
  templateKey,
  label,
  variant = 'primary',
  className,
}: {
  action: (templateKey: string) => Promise<AdoptOutcome>;
  templateKey: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hatch, setHatch] = useState<Appearance | null>(null);

  function adopt() {
    startTransition(async () => {
      const outcome = await action(templateKey);
      if (!outcome.ok) {
        router.push(outcome.redirectTo);
        return;
      }
      setHatch(outcome);
    });
  }

  return (
    <>
      <Button type="button" variant={variant} className={className} onClick={adopt} disabled={pending}>
        {pending ? 'Adopting…' : label}
      </Button>
      {hatch && (
        <AdoptHatch
          name={hatch.name}
          species={hatch.species}
          stage={hatch.stage}
          palette={hatch.palette}
          accessory={hatch.accessory}
          marking={hatch.marking}
          isFirstAdoption={hatch.isFirstAdoption}
          onDismiss={() => router.push(hatch.ctaPath)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2 — typecheck.** Run: `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0.

- [ ] **Step 3 — commit.**

```bash
cd /c/Nibbin && git add apps/web/components/adopt/AdoptButton.tsx
git commit -m "feat(web): AdoptButton — run the adopt action, then play the hatch"
```

---

### Task 5: Wire the diagnosis reveal

**Files:**
- Modify: `apps/web/app/app/diagnosis/actions.ts`
- Modify: `apps/web/app/app/diagnosis/DiagnosisReveal.tsx`

- [ ] **Step 1 — replace `adoptRecommendation` in `actions.ts`** with an outcome-returning action (keep imports; keep `deleteDiagnosis` unchanged). Replace lines 14-32 with:

```ts
import type { AdoptOutcome } from '../../../components/adopt/types';

/**
 * Adopt a recommended Nibbin straight from the diagnosis reveal. Returns an
 * AdoptOutcome so the client can play the hatch ceremony; a missing connector
 * or error becomes a navigation the client performs instead of a redirect here.
 */
export async function adoptRecommendationOutcome(templateKey: string): Promise<AdoptOutcome> {
  const key = templateKey.trim();
  if (!key) return { ok: false, redirectTo: '/app/diagnosis' };

  const { user, accountId } = await appSession();

  try {
    const result = await adoptTemplate(accountId, user.id, key);
    if (result.missingConnectors.length > 0) {
      return {
        ok: false,
        redirectTo: `/app/diagnosis?needs=${encodeURIComponent(result.missingConnectors.join(','))}`,
      };
    }
    return {
      ok: true,
      nibbinId: result.nibbinId,
      name: result.name,
      species: result.species,
      stage: result.stage,
      palette: result.palette,
      accessory: result.accessory,
      marking: result.marking,
      isFirstAdoption: result.isFirstAdoption,
      ctaPath: '/app',
    };
  } catch {
    return { ok: false, redirectTo: '/app/diagnosis?error=adopt' };
  }
}
```

Then remove the now-unused `redirect` import IF `deleteDiagnosis` no longer needs it — it DOES (it calls `redirect('/app/diagnosis')`), so **keep `redirect` imported**.

- [ ] **Step 2 — update `DiagnosisReveal.tsx`.** Change the import on line 3 from `import { adoptRecommendation } from './actions';` to:

```ts
import { adoptRecommendationOutcome } from './actions';
import { AdoptButton } from '../../../components/adopt/AdoptButton';
```

Replace the `<form>` block (lines 165-170) with:

```tsx
                  <AdoptButton
                    action={adoptRecommendationOutcome}
                    templateKey={key}
                    label={`Adopt ${NIBBIN_NAME[key] ?? key}`}
                    className={styles.recForm}
                  />
```

(If `styles.recForm` was layout for the `<form>` wrapper and now mis-styles a button, drop the `className` — the `<AdoptButton>` renders its own primary `Button`. Verify the reveal still lines up; prefer removing `className` over fighting it.)

- [ ] **Step 3 — typecheck.** Run: `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0.

- [ ] **Step 4 — commit.**

```bash
cd /c/Nibbin && git add apps/web/app/app/diagnosis/actions.ts apps/web/app/app/diagnosis/DiagnosisReveal.tsx
git commit -m "feat(web): diagnosis reveal adopts with the hatch ceremony"
```

---

### Task 6: Wire the shop

**Files:**
- Modify: `apps/web/app/app/shop/actions.ts`
- Modify: `apps/web/app/app/shop/page.tsx`

- [ ] **Step 1 — replace `adoptFromShopAction` in `actions.ts`** with an outcome-returning action. Replace the whole file body below the docstring with:

```ts
'use server';

/**
 * Shop adoption action (§4.6): one tap adopts; the Nibbin hatches in the grove
 * and the first draft follows fast. Returns an AdoptOutcome so the client can
 * play the hatch ceremony; the limit / missing-connector paths become a
 * navigation the client performs.
 */
import { SHOP_TEMPLATE_KEYS } from '@nibbin/runtime';
import { appSession } from '../../../lib/auth/app-session';
import { adoptTemplate } from '../../../lib/runtime/adopt';
import type { AdoptOutcome } from '../../../components/adopt/types';

export async function adoptFromShopOutcome(templateKey: string): Promise<AdoptOutcome> {
  if (!SHOP_TEMPLATE_KEYS.includes(templateKey)) throw new Error('unknown template');

  const { user, accountId } = await appSession();
  let result;
  try {
    result = await adoptTemplate(accountId, user.id, templateKey);
  } catch (e) {
    if (e instanceof Error && e.message === 'nibbin_limit') {
      return { ok: false, redirectTo: '/app/shop?limit=1' };
    }
    throw e;
  }

  if (result.missingConnectors.length > 0) {
    return {
      ok: false,
      redirectTo:
        `/app/connections?needed=${encodeURIComponent(result.missingConnectors.join(','))}` +
        `&resume=${encodeURIComponent(templateKey)}`,
    };
  }

  return {
    ok: true,
    nibbinId: result.nibbinId,
    name: result.name,
    species: result.species,
    stage: result.stage,
    palette: result.palette,
    accessory: result.accessory,
    marking: result.marking,
    isFirstAdoption: result.isFirstAdoption,
    ctaPath: '/app',
  };
}
```

- [ ] **Step 2 — update `page.tsx`.** Add near the existing imports:

```ts
import { AdoptButton } from '../../../components/adopt/AdoptButton';
import { adoptFromShopOutcome } from './actions';
```

(Confirm the file does not already import `adoptFromShopAction`; if it does, replace that import line.) Replace the `<form>` block (lines 121-126) with:

```tsx
                    <AdoptButton
                      action={adoptFromShopOutcome}
                      templateKey={t.key}
                      label={`Adopt ${t.spec.displayName}`}
                      className={styles.adopt}
                    />
```

(`styles.adopt` previously styled the `<button>`. `AdoptButton` forwards `className` onto its `Button`, so the existing shop-button styling carries over. If `Button`'s own base classes clash, drop `className` and accept the primary pill.)

- [ ] **Step 3 — typecheck.** Run: `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0.

- [ ] **Step 4 — commit.**

```bash
cd /c/Nibbin && git add apps/web/app/app/shop/actions.ts apps/web/app/app/shop/page.tsx
git commit -m "feat(web): shop adopts with the hatch ceremony"
```

---

### Task 7: Verify

- [ ] **Step 1 — full typecheck.** Run: `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0.
- [ ] **Step 2 — lint the touched files** (if eslint is wired): `cd /c/Nibbin && npx eslint apps/web/components/adopt apps/web/app/app/diagnosis apps/web/app/app/shop --max-warnings=0` → clean (skip if eslint not configured for the workspace).
- [ ] **Step 3 — no stray hex / coral in the new CSS:** `grep -rnE "#[0-9A-Fa-f]{6}|coral" apps/web/components/adopt/adopt-hatch.module.css` → none (rgba ink in the backdrop is the only literal; that matches the grove pattern of token-derived ink — acceptable, but confirm it reads `rgba(35, 41, 26, …)` = `--ink`).
- [ ] **Step 4 — confirm no dangling references to the removed actions:** `grep -rn "adoptRecommendation\b\|adoptFromShopAction" apps/web` → only `adoptRecommendationOutcome` / `adoptFromShopOutcome` should remain.

## Self-review
- **Gate-free:** no migration, no `packages/runtime`/`keeper`/`router`/`connectors`, no `apps/web/app/api`, no `src-tauri`. All paths (`apps/web/lib/runtime`, `apps/web/app/app/*`, `apps/web/components/*`) are outside the CI sensitive-path regex.
- **Design-faithful:** choreography lifted from the grove hatch (`grove-crack`/`grove-hop`/`grove-burst`), tokens-only, `Button` reused, reduced-motion honored (static reveal, burst hidden), sentence-case earned copy with drafts-for-approval framing (C10-consistent), engine is the only sprite source.
- **Behavior:** first adoption (count===0 before write) → hero; later → light. Missing connectors / limit / error never show the overlay — they navigate. Trigger-graph validation + tier cap stay below this layer untouched.
- **Spec coverage:** Beat 2 of the ceremony spec (`docs/superpowers/specs/2026-06-17-ceremony-reveal-design.md`) — focused overlay on current page, first-adoption hero — both forks the user chose.
