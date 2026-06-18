# Beat 3 — In-Grove Promotion Celebration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** When the user opens **Grove Home** and one of their Nibbins was recently promoted in Agent School (evolution/graduation) and hasn't been celebrated in-context **on this device**, the docked Grovekeeper plays a one-time moment: the promoted Nibbin's creature re-renders **at its new stage** in a celebration bubble + the Keeper goes **delighted** with a **leaf-burst** + the earned line. Returning visits don't replay it. Reduced-motion → static, no burst.

**Architecture:** The promotion already lands an enriched `notifications` row (kind `evolution`/`graduation`, payload carries `nibbinId/species/stage/palette/accessory/marking` — shipped in #122). Grove Home (server) reads the recent ones and passes them as `pendingCelebrations` → `KeeperPanel` → `KeeperChat`. `KeeperChat` (client) filters out any already shown (localStorage keyed by notification id), injects a **local celebration chat-item** (NOT a `@nibbin/keeper` card — that type is gated), sets the Keeper `delighted` + bumps `burstKey`, and marks them celebrated. The Keeper sprite remains the *narrator*; the promoted Nibbin's creature is the *subject* (CE-P5).

**Gate-free:** touches only `apps/web/app/app/page.tsx`, `apps/web/app/app/grove/KeeperPanel.tsx`, `apps/web/app/app/grove/KeeperChat.tsx`, `apps/web/app/app/grove/keeper-chat.module.css` — none in the CI sensitive-path regex. **No migration** (notifications already exist + carry the creature payload). **No `packages/keeper`** (celebration is a local chat-item, not a card-type change).

**Design contract (CE-P1/P2/P5, §7/§8/§9):** earned/sentence-case copy (reuse the notification `body` as the line); restrained-warm (reuse the existing `delighted` + leaf-burst, nothing more); engine is the only sprite source; reduced-motion → static. Demotion echo (CE5) is **out of scope** here — no demotion notification exists yet; it rides with the (gated) promotion-rubric drift nudge later.

## File structure
- **Modify** `apps/web/app/app/page.tsx` — query recent promotion notifications, map → `Celebration[]`, pass to `KeeperPanel`.
- **Modify** `apps/web/app/app/grove/KeeperPanel.tsx` — accept + forward `pendingCelebrations`.
- **Modify** `apps/web/app/app/grove/KeeperChat.tsx` — `Celebration` type (exported), `ChatItem.celebration`, mount-time injection effect, render branch, nosemgrep on the creature render.
- **Modify** `apps/web/app/app/grove/keeper-chat.module.css` — celebration-creature layout (tokens-only).

---

### Task 1: `KeeperChat` — type, item, injection, render

**Files:** Modify `apps/web/app/app/grove/KeeperChat.tsx`

- [ ] **Step 1 — add the creature-engine import** near the top imports:
```tsx
import { buildCreature, type SpeciesName, type Stage, type Accessory, type Marking } from '@nibbin/creatures';
```

- [ ] **Step 2 — export the `Celebration` type** (place it just above the `KeeperChat` function; `page.tsx` imports it type-only):
```tsx
/** A recent promotion to celebrate in-grove (one notifications row). */
export interface Celebration {
  id: string;            // notification id — the per-device "shown" key
  kind: 'evolution' | 'graduation';
  title: string;         // "{name} graduated" / "{name} evolved"
  line: string;          // earned copy (the notification body)
  species: string;
  stage: string;         // the NEW stage
  palette: string | null;
  accessory: string;
  marking: string;
}
```

- [ ] **Step 3 — extend `ChatItem`** (interface near line 29) with an optional celebration:
```tsx
interface ChatItem {
  id: string;
  from: 'keeper' | 'user';
  message?: KeeperMessage;
  text?: string;
  celebration?: Celebration;
}
```

- [ ] **Step 4 — accept the prop.** Add `pendingCelebrations = []` to the destructured props and its type:
```tsx
  pendingCelebrations = [],
```
and in the props type:
```tsx
  /** Recent promotions to celebrate in-grove (Beat 3); panel variant only. */
  pendingCelebrations?: Celebration[];
```

- [ ] **Step 5 — inject on mount.** Add an effect AFTER the existing hatch effect (the one keyed on `[reducedMotion]`). It fires once, only on the docked panel at the home state, only for promotions not yet shown on this device:
```tsx
  /* Beat 3: celebrate recent promotions the first time they're seen in-grove.
     Per-device via localStorage (keyed by notification id) — never replays.
     Silence/onboarding never trips it (gated on step==='done' + !freshHatch). */
  useEffect(() => {
    if (!isPanel || freshHatch || step !== 'done' || pendingCelebrations.length === 0) return;
    let fresh: Celebration[];
    try {
      fresh = pendingCelebrations.filter(
        (c) => window.localStorage.getItem(`nibbin:promo-celebrated:${c.id}`) !== '1',
      );
    } catch {
      return; // storage blocked — skip silently rather than risk a replay loop
    }
    if (fresh.length === 0) return;
    // Coalesce to at most the 3 most recent to avoid a pile-up.
    const show = fresh.slice(0, 3);
    show.forEach((c, i) => {
      const item: ChatItem = { id: localId(`celebrate-${c.id}`), from: 'keeper', celebration: c };
      later(() => setItems((prev) => [...prev, item]), i * 520);
    });
    later(() => {
      setExpression('delighted');
      setBurstKey((k) => k + 1);
    }, Math.max(0, (show.length - 1) * 520));
    fresh.forEach((c) => {
      try {
        window.localStorage.setItem(`nibbin:promo-celebrated:${c.id}`, '1');
      } catch {
        /* ignore */
      }
    });
    // Mount-only: pendingCelebrations is a stable server prop for this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```
(Under reduced motion `later` runs synchronously-ish via the existing timer helper; the burst CSS is disabled by the grove reduced-motion block, so no extra guard is needed. If `later` is defined to honor `reducedMotion` by collapsing delays, that already applies.)

- [ ] **Step 6 — render the celebration item.** In the `items.map(...)` (around line 261), add a branch BEFORE the existing keeper/user branches so a celebration item renders its own bubble:
```tsx
      {items.map((item) =>
        item.celebration ? (
          <div key={item.id} className={styles.celebrationCard}>
            <span
              className={styles.celebrateCreature}
              aria-hidden="true"
              // creature SVG is built by the in-repo @nibbin/creatures engine from
              // fixed enum fields on a trusted notifications row — never user HTML
              // (same trust basis as nibbins/page.tsx).
              // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml
              dangerouslySetInnerHTML={{
                __html: buildCreature({
                  species: item.celebration.species as SpeciesName,
                  stage: item.celebration.stage as Stage,
                  color: item.celebration.palette ?? undefined,
                  acc: item.celebration.accessory as Accessory,
                  mark: item.celebration.marking as Marking,
                  size: 56,
                }),
              }}
            />
            <span className={styles.celebrateText}>
              <strong className={styles.celebrateTitle}>{item.celebration.title}</strong>
              <span className={styles.celebrateLine}>{item.celebration.line}</span>
            </span>
          </div>
        ) : item.from === 'user' ? (
          <div key={item.id} className={styles.userBubble}>
            {item.text}
          </div>
        ) : (
          <div
            key={item.id}
            className={
              item.message!.card.kind === 'celebration' ? styles.celebrationCard : styles.keeperBubble
            }
          >
            <CardView card={item.message!.card} />
          </div>
        ),
      )}
```

- [ ] **Step 7** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): KeeperChat celebrates recent promotions in-grove (Beat 3)`.

---

### Task 2: `KeeperPanel` forwards the celebrations

**Files:** Modify `apps/web/app/app/grove/KeeperPanel.tsx`

- [ ] **Step 1** — import the type + add the prop. Add to the import from `./KeeperChat`:
```tsx
import { KeeperChat, type Celebration } from './KeeperChat';
```
Add to `KeeperPanelProps`:
```tsx
  /** Recent promotions to celebrate in-grove (Beat 3). */
  pendingCelebrations: Celebration[];
```
Add `pendingCelebrations` to the destructured params, and pass it through to `<KeeperChat ... pendingCelebrations={pendingCelebrations} />`.

- [ ] **Step 2** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): KeeperPanel forwards pendingCelebrations`.

---

### Task 3: Grove Home loads recent promotions

**Files:** Modify `apps/web/app/app/page.tsx`

- [ ] **Step 1 — import the type** (top of file, with the other `./grove` imports):
```tsx
import type { Celebration } from './grove/KeeperChat';
```

- [ ] **Step 2 — add the query** to the `Promise.all([...])` (after the `approvals` query, ~line 294). The window is 14 days so a promotion earned just before a visit still celebrates; the localStorage de-dupe prevents replays:
```tsx
    // Recent promotions (Beat 3) — celebrated in-grove on first sight (per-device).
    supabase
      .from('notifications')
      .select('id, kind, title, body, payload, created_at')
      .eq('account_id', accountId)
      .in('kind', ['evolution', 'graduation'])
      .gte('created_at', new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(5),
```

- [ ] **Step 3 — destructure it** by adding to the `const [ ... ] = await Promise.all([...])` left side (after `{ data: approvalsData }`):
```tsx
    { data: promoNotifData },
```

- [ ] **Step 4 — map → `Celebration[]`** (near where `approvals` is cast, ~line 300). Only rows whose payload carries a species can render a creature:
```tsx
  const pendingCelebrations: Celebration[] = (
    (promoNotifData ?? []) as Array<{
      id: string;
      kind: string;
      title: string;
      body: string;
      payload: {
        species?: string; stage?: string; palette?: string | null; accessory?: string; marking?: string;
      } | null;
    }>
  )
    .filter((r) => r.payload?.species && (r.kind === 'evolution' || r.kind === 'graduation'))
    .map((r) => ({
      id: r.id,
      kind: r.kind as 'evolution' | 'graduation',
      title: r.title,
      line: r.body,
      species: r.payload!.species as string,
      stage: r.payload!.stage as string,
      palette: (r.payload!.palette as string) ?? null,
      accessory: (r.payload!.accessory as string) ?? 'none',
      marking: (r.payload!.marking as string) ?? 'none',
    }));
```

- [ ] **Step 5 — pass it to the panel** (the `keeperPanel` JSX, ~line 384):
```tsx
  const keeperPanel = (
    <KeeperPanel
      initialMessages={initialMessages}
      initialExpression={expression}
      initialStep={grove.step}
      keeperName={grove.keeperName}
      credits={credits}
      initialProfile={grove.profile}
      hasConnection={hasConnection}
      pendingCelebrations={pendingCelebrations}
    />
  );
```

- [ ] **Step 6** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): Grove Home loads recent promotions for the Beat 3 celebration`.

---

### Task 4: Celebration bubble styling

**Files:** Modify `apps/web/app/app/grove/keeper-chat.module.css`

- [ ] **Step 1 — add the layout** (reuse the existing `.celebrationCard` container; add the creature row). Read the file first to match its token usage + existing `.celebrationCard` rule, then append:
```css
.celebrateCreature {
  flex-shrink: 0;
  line-height: 0;
}
.celebrateCreature :global(svg) {
  display: block;
}
.celebrateText {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.celebrateTitle {
  font-family: var(--display);
  font-weight: 700;
  font-size: 14px;
  color: var(--ink);
}
.celebrateLine {
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink-soft);
}
```
Ensure `.celebrationCard` lays its children in a row with a gap (if it doesn't already): add `display: flex; gap: 10px; align-items: center;` to the existing `.celebrationCard` rule ONLY if absent — do not duplicate the rule; if it already flexes, leave it.

- [ ] **Step 2** — no raw hex; tokens only (`--display`, `--ink`, `--ink-soft` exist in tokens.css). `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): celebration bubble styling for the in-grove promotion moment`.

---

### Task 5: Verify
- [ ] `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0.
- [ ] `cd /c/Nibbin && grep -n "nosemgrep" apps/web/app/app/grove/KeeperChat.tsx` → exactly 1 (the celebration creature render).
- [ ] `cd /c/Nibbin && grep -rnE "#[0-9A-Fa-f]{6}" apps/web/app/app/grove/keeper-chat.module.css` → no NEW hex from the appended block.
- [ ] `cd /c/Nibbin && grep -rn "pendingCelebrations" apps/web/app/app/` → present in page.tsx, KeeperPanel.tsx, KeeperChat.tsx.

## Self-review
- **Gate-free:** no migration, no `packages/keeper`/`runtime`, no sensitive path. Reads the existing enriched notifications.
- **Spec §7:** in-context moment on grove visit — creature at NEW stage + Keeper delighted + leaf-burst + earned line (the notification body). Keeper narrates / Nibbin is subject (CE-P5). First-sight only (localStorage per notification id); silence/onboarding never trips it (step==='done' + !freshHatch). Reduced-motion → static (grove reduced-motion CSS disables the burst; no new motion added). Coalesces to ≤3 (§9). Demotion echo deferred (no data source yet — rides with the rubric drift nudge).
- **Trust/brand:** engine-only sprite with the nosemgrep precedent (AdoptHatch/RevealKeeper); earned, sentence-case copy reused from the drip body; nothing gamified.
