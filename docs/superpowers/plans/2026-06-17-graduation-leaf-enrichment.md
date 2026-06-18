# Graduation Leaf Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** When a Nibbin is promoted in Agent School, its evolution/graduation **notification leaf shows the creature at its new stage** + earned Keeper copy + a click-through to the roster — turning today's plain text leaf into a visible celebration inside the new Notification Center (and the archive).

**Architecture:** No schema change (the `notifications.payload` jsonb already exists). The drip pipeline (which already produces these leaves async from `audit_log`) carries the Nibbin's creature fields into the payload; the Notification Center dropdown + the archive page render `buildCreature(...)` at the new stage. **Gate-free** (touches `packages/drip`, `apps/web/app/app/notifications`, `apps/web/components/shell` — none in the CI sensitive-path regex; no migration; no `packages/keeper`).

**Design contract:** creature rendered like the roster (`apps/web/app/app/nibbins/page.tsx` — `buildCreature` + `dangerouslySetInnerHTML`, `creatureCss`); small (≈40px) in the dropdown, larger (≈60px) in the archive; tokens-only spacing; keep the existing earned copy ("Graduated on verified accuracy — earned, never time-served." / "Evolved to {stage} — earned on your approvals."). Brand: trust is visible.

## File structure
- **Modify** `packages/drip/src/types.ts` — extend `EarnedEvent` with creature fields.
- **Modify** `packages/drip/src/pg-arc-data.ts` — `earnedEvents` SQL selects the creature fields; map them.
- **Modify** `packages/drip/src/pg-store.ts` — `insertEarnedNotification` writes the payload.
- **Modify** `apps/web/app/app/notifications/actions.ts` — `Leaf` carries optional `creature`; map from payload.
- **Modify** `apps/web/components/shell/NotificationBell.tsx` + `notification-center.module.css` — render the creature in the dropdown leaf.
- **Modify** `apps/web/app/app/notifications/page.tsx` + `notifications.module.css` — render the creature in the archive leaf.

---

### Task 1: Drip carries creature fields into the leaf payload

- [ ] **Step 1 — `packages/drip/src/types.ts`**, extend `EarnedEvent`:
```ts
export interface EarnedEvent {
  id: string;
  kind: 'evolution' | 'graduation';
  nibbin: string;
  detail: string;
  // creature metadata for the in-leaf celebration (rendered at the NEW stage)
  nibbinId: string;
  species: string;
  stage: string;
  palette: string | null;
  accessory: string | null;
  marking: string | null;
}
```

- [ ] **Step 2 — `packages/drip/src/pg-arc-data.ts`**, replace the `earnedEvents` query + map (n.stage is the post-promotion/new stage):
```ts
      const r = await pool.query<{
        id: string; to_stage: string; nibbin: string; nibbin_id: string;
        species: string; stage: string; palette: string | null; accessory: string | null; marking: string | null;
      }>(
        `select l.id, l.meta ->> 'to' as to_stage, n.name as nibbin,
                n.id::text as nibbin_id, n.species, n.stage, n.palette, n.accessory, n.marking
           from audit_log l
           join nibbins n on n.id::text = l.subject
          where l.account_id = $1
            and l.action = 'nibbin.stage_promoted'
            and l.at > now() - interval '30 days'
          order by l.at asc`,
        [accountId],
      );
      return r.rows.map((row) => ({
        id: row.id,
        kind: row.to_stage === 'grad' ? ('graduation' as const) : ('evolution' as const),
        nibbin: row.nibbin,
        detail:
          row.to_stage === 'grad'
            ? 'Graduated on verified accuracy — earned, never time-served.'
            : `Evolved to ${row.to_stage} — earned on your approvals.`,
        nibbinId: row.nibbin_id,
        species: row.species,
        stage: row.stage,
        palette: row.palette,
        accessory: row.accessory,
        marking: row.marking,
      }));
```

- [ ] **Step 3 — `packages/drip/src/pg-store.ts`**, `insertEarnedNotification` writes the payload:
```ts
    async insertEarnedNotification(accountId, event: EarnedEvent): Promise<void> {
      const title = event.kind === 'graduation' ? `${event.nibbin} graduated` : `${event.nibbin} evolved`;
      await pool.query(
        `insert into notifications (account_id, kind, source_id, title, body, payload)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (account_id, kind, source_id) do nothing`,
        [
          accountId, event.kind, event.id, title, event.detail,
          JSON.stringify({
            ctaPath: '/app/nibbins',
            ctaLabel: 'See your Nibbins',
            nibbinId: event.nibbinId,
            species: event.species,
            stage: event.stage,
            palette: event.palette,
            accessory: event.accessory ?? 'none',
            marking: event.marking ?? 'none',
          }),
        ],
      );
    },
```

- [ ] **Step 4** — if `packages/drip/test/arc.test.ts` constructs `EarnedEvent` fixtures or asserts the earned-notification insert, update them for the new fields (give the fixtures `nibbinId/species/stage/palette/accessory/marking`; assert the payload is written). Run `cd /c/Nibbin && npx vitest run packages/drip/test` → green. Commit: `feat(drip): carry creature fields into evolution/graduation leaf payload`.

---

### Task 2: Render the creature in the Notification Center dropdown

- [ ] **Step 1 — `apps/web/app/app/notifications/actions.ts`**: extend `Leaf` + the map in `listLeaves`:
```ts
export interface Leaf {
  id: string;
  kind: 'beat' | 'evolution' | 'graduation';
  title: string;
  body: string;
  ctaPath: string | null;
  ctaLabel: string | null;
  createdAt: string;
  read: boolean;
  creature: { species: string; stage: string; palette: string | null; accessory: string; marking: string } | null;
}
```
In the row type, broaden `payload` to include the creature fields; in the map add:
```ts
    creature: r.payload?.species
      ? {
          species: r.payload.species as string,
          stage: r.payload.stage as string,
          palette: (r.payload.palette as string) ?? null,
          accessory: (r.payload.accessory as string) ?? 'none',
          marking: (r.payload.marking as string) ?? 'none',
        }
      : null,
```

- [ ] **Step 2 — `NotificationBell.tsx`**: import the engine and render the creature when present. At top:
```tsx
import { buildCreature, type SpeciesName, type Stage, type Accessory, type Marking } from '@nibbin/creatures';
```
Inside the leaf button, before the title block, wrap content in a row and conditionally render the creature (≈40px):
```tsx
        <span className={styles.leafRow}>
          {leaf.creature && (
            <span
              className={styles.leafCreature}
              aria-hidden="true"
              dangerouslySetInnerHTML={{
                __html: buildCreature({
                  species: leaf.creature.species as SpeciesName,
                  stage: leaf.creature.stage as Stage,
                  color: leaf.creature.palette ?? undefined,
                  acc: leaf.creature.accessory as Accessory,
                  mark: leaf.creature.marking as Marking,
                  size: 40,
                }),
              }}
            />
          )}
          <span className={styles.leafText}>
            <span className={styles.leafTitle}>{leaf.title}</span>
            <span className={styles.leafBody}>{leaf.body}</span>
            <span className={styles.leafTime}>{relTime(leaf.createdAt)}</span>
          </span>
        </span>
```
(Adjust the existing `<p>`→`<span>` so they nest legally inside the button; keep the same class names. The dropdown renders only when open — client-side, post-hydration — so the engine's per-render gradient ids are fine.)

- [ ] **Step 3 — `notification-center.module.css`**: add
```css
.leafRow { display: flex; gap: 10px; align-items: flex-start; }
.leafCreature { flex-shrink: 0; line-height: 0; margin-top: 2px; }
.leafCreature :global(svg) { display: block; }
.leafText { display: flex; flex-direction: column; min-width: 0; }
```
(Keep existing `.leafTitle/.leafBody/.leafTime` rules; they apply to the spans.)

- [ ] **Step 4** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): render the new-stage creature on graduation leaves in the bell`.

---

### Task 3: Render the creature in the archive page

- [ ] **Step 1 — `apps/web/app/app/notifications/page.tsx`**: add `payload` to the `LeafRow` interface + the `.select(...)`; render `buildCreature(...)` (≈60px) for `evolution`/`graduation` leaves with `payload.species`, exactly as `apps/web/app/app/nibbins/page.tsx` does (import `buildCreature` + types, `dangerouslySetInnerHTML`, inject `creatureCss` once at the top of the list). Lay the creature beside the title/body (a flex row); keep the existing mark-read form.
- [ ] **Step 2 — `notifications.module.css`**: add the matching `.leafRow`/`.leafCreature`/`.leafText` row styles (tokens-only).
- [ ] **Step 3** — `npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): render the new-stage creature on graduation leaves in the archive`.

---

### Task 4: Verify
- [ ] `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0.
- [ ] `cd /c/Nibbin && npx vitest run packages/drip/test apps/web/lib/` → green (drip payload + no web regressions).
- [ ] grep the changed web files for stray hex/coral (`grep -rnE "#[0-9A-Fa-f]{6}|coral" apps/web/components/shell/notification-center.module.css apps/web/app/app/notifications/notifications.module.css`) → none.

## Self-review
- Gate-free (no migration, no sensitive path); design-faithful (roster creature pattern, tokens, earned copy); the creature shows the **new** stage (`n.stage` is post-promotion); click-through to `/app/nibbins` via the center's existing `ctaPath` handling. Beats (no `species` in payload) render unchanged.
