# Implementation Plan — P1: Memory Page Redesign (Company Brain)

**Date:** 2026-06-23
**Branch:** `feature/company-brain-memory-redesign` (worktree `C:\nib-p1`)
**Design source of truth:** `docs/superpowers/specs/2026-06-22-memory-page-redesign-design.md`
**Reference:** `C:\nib-cbrain\docs\COMPANY-BRAIN.md` §4.2 / §4.3 / §13 / §14.5

---

## ⚠️ Pre-implementation: rebase onto Foundation

> **Before writing any code, rebase this branch onto `feature/company-brain-foundation`.**
> The provenance/staleness line (§11) and the Sources-tab evidence list (§8.2) consume F1's
> `field_meta` / `field_evidence` / `sources` tables. Without the rebase those features can only
> ship as empty stubs, which is acceptable for a first cut but means a second rebase later.
>
> ```bash
> cd /c/nib-p1
> git fetch origin
> git rebase origin/feature/company-brain-foundation
> ```
>
> **Independent of F1** (build these regardless of rebase state): the curated-tab view/edit toggle,
> structural plain-text formatting, hard-rules coral treatment, framing strip, empty state,
> per-field save (Option A mirror), the `reference_text` column + Reference catch-all. These touch
> only `grove_memory`, which exists today (migration `20260613130000_m7_grove_memory.sql`).
>
> The provenance slot and evidence list are built to render gracefully empty **whether or not** F1
> is present (Tasks 12 & 13 gate on table existence / a feature flag, never on a build-time type
> import). So the plan is safe to execute even if the rebase is deferred — F1 features light up
> automatically once the tables land.

---

## Goal

Turn the Memory page from a form of naked textareas into the **Company Brain**: a two-tab
(Grove Memory / Sources), view-by-default document where each curated field is locked, formatted,
and edited deliberately one at a time. Bake in the four locked decisions:

1. **Per-field Edit → Save**, locked (view) by default (Fork 1 = per-field).
2. **Separate `reference_text` column** — a small additive migration. "Anything else" (`notes`)
   stays a field on the Grove Memory truth tab; **Reference** is its own Sources-tab catch-all in
   the new column. (This **overrides spec Fork 3**, which proposed reusing `notes`.)
3. **Structural plain-text rendering** (Fork 2 = structural) — derive lists / definition-lists /
   blockquotes from raw text (`\n`, `label:` prefixes, `$` price patterns). No markdown parser.
   Keeps the stored blob LLM-clean for `loadGroveMemoryBlock`.
4. **Hard rules get coral *authority* styling**; **provenance/staleness line** is a reserved,
   silent slot pre-F1 that populates from `field_meta` when F1 lands.

## Architecture

- **`page.tsx` stays a server component.** It fetches `grove_memory` (now also `reference_text`),
  seeds `facts` from onboarding on first visit exactly as today, computes `isEmpty`, and renders a
  single `<MemoryClient>` passing `initialValues`, `initialReference`, `isEmpty`, and (post-F1)
  `fieldMeta`. No `<form action=…>` in the server tree anymore.
- **`MemoryClient.tsx` (`'use client'`)** owns the tab state and the `values: Record<string,string>`
  mirror (Option A, §5.4). Each per-field save sends the **full current mirror** through the
  unchanged `saveGroveMemory` server action — zero RPC change for the curated fields. The Reference
  field saves through a **new** `saveReference` action that writes the new column.
- **Pure formatters** (`format.ts`) turn raw field text into a structured descriptor
  (`{ kind: 'list' | 'dl' | 'quote' | 'paragraphs' | 'empty', … }`). Components render the
  descriptor. **All formatting logic is unit-tested as pure functions** — the moat of this plan.
- **Component tree** (from spec §12), all under `apps/web/app/app/memory/`:
  `MemoryClient → { TabBar, GroveMemoryTab → { FramingStrip, MemorySection, FieldBlock →
  { FieldView, FieldEditor }, HardRulesBlock, EmptyState }, SourcesTab → { ReferenceCatchAll,
  EvidenceList } }`.
- **CSS** stays in the co-located `memory.module.css`, extended with token-only classes
  (no new design tokens; no hard-coded values).

## Global constraints

- **TDD, strictly.** Red → green → commit per task. Write the failing test first, watch it fail,
  implement minimally, watch it pass, commit. Never write implementation before its test.
- **Test runner:** vitest (`vitest.config.ts` at repo root). Component/unit tests live next to the
  code (`apps/web/app/app/memory/*.test.ts[x]`, matched by `apps/*/app/**/*.test.tsx`). RLS tests
  live in `tests/rls/*.test.ts` and run against a **live Postgres** (`fileParallelism: false`).
- **Component test style = this repo's convention:** `renderToStaticMarkup` from `react-dom/server`
  (see `apps/web/components/help/HelpAccordion.test.tsx`). There is **no jsdom / testing-library**
  in this repo. Therefore: test all *logic* (formatters, mirror-merge, mode reducers, source-label
  maps, staleness threshold) as pure functions; test *components* by asserting on rendered static
  HTML (presence of classes, text, `aria-*`, the right tag for the right field kind). Do **not**
  attempt to assert click→state transitions in vitest — extract that logic into pure reducers and
  test those.
- **No schema change beyond the one additive `reference_text` column.** `MEMORY_SECTIONS`,
  `save_grove_memory`, and `loadGroveMemoryBlock` are **not** touched (spec §15).
- **Token-only CSS.** Use existing tokens (`--canopy`, `--understory`, `--moss*`, `--coral*`,
  `--honey-deep`, `--ink*`, `--line`, `--r-*`, `--dur-*`, `--ease-settle`, `--display`, `--mono`).
  Follow the **frontend-design** skill's constraint of intentional, system-consistent styling — this
  surface extends an established token system, so the discipline is *restraint and precision*, not a
  new palette.
- **Migrations apply to all three DBs** (dev + staging + prod) — see the reference note
  `reference_supabase_instances.md`. The migration is additive and nullable, so it is safe to apply
  before the code ships.
- **Run before every commit:** `npm run lint` and `npm run typecheck` (not just the test command —
  per memory, subagent "tests pass" claims have repeatedly missed lint/type/router CI failures).

### Test commands (reference)

```bash
# Single file (fast inner loop):
npx vitest run apps/web/app/app/memory/format.test.ts
# All memory unit/component tests:
npx vitest run apps/web/app/app/memory
# RLS (live Postgres; sequential):
npx vitest run tests/rls/grove-memory-reference.test.ts
# Gate before each commit:
npm run lint && npm run typecheck
```

---

## Task list

### Task 1 — `reference_text` column migration (additive, nullable)
- **Test first:** `tests/rls/grove-memory-reference.test.ts` — apply the migration into the live
  test schema, then assert: (a) `grove_memory.reference_text` exists, is `text`, nullable; (b) a
  CHECK rejects `char_length > 8000`; (c) an authenticated member can read it under RLS; (d) anon
  cannot. Follow the existing `tests/rls/*.test.ts` harness (each file resets `public`).
- **Implement:** new migration `supabase/migrations/20260623120000_grove_memory_reference_text.sql`
  (next free slot after `20260622130000`):
  ```sql
  alter table public.grove_memory
    add column reference_text text
      check (reference_text is null or char_length(reference_text) <= 8000);
  ```
  Do **not** alter `save_grove_memory` (it stays the curated-field path). Reference gets its own
  RPC in Task 2.
- **Run:** `npx vitest run tests/rls/grove-memory-reference.test.ts` → green.
- **Commit:** `feat(memory): add reference_text column to grove_memory`.

### Task 2 — `save_reference` RPC (member-checked, single write path)
- **Test first:** extend the Task 1 RLS test — calling `save_reference(account, text)` as a member
  upserts the column and bumps `version`; as a non-member it raises; `> 8000` chars raises; anon &
  `service_role` lack execute.
- **Implement:** in the **same** migration file, mirror the `save_grove_memory` shape: `security
  definer`, `set search_path=''`, `auth.uid()` + `is_account_member` re-check, advisory lock on
  `'grove_memory:'||account`, `on conflict (account_id) do update set reference_text=…, version=
  version+1, updated_at=now()`. `revoke … from public, anon, service_role`; `grant execute … to
  authenticated`.
- **Run / Commit:** green → `feat(memory): add save_reference RPC for the Reference catch-all`.

### Task 3 — Field formatters (`format.ts`) — the structural-rendering core
- **Test first:** `apps/web/app/app/memory/format.test.ts`. Cover, as pure functions:
  - `formatField(kind, raw)` → descriptor. `kind: 'list'` (pricing/policies/faq): multi-line →
    `{kind:'list', items:[…]}`; single line → `{kind:'paragraphs'}` (one-item lists feel
    incomplete, §6.2); blank lines → separator markers.
  - `kind: 'dl'` (facts): `label: value` lines → `{kind:'dl', rows:[{dt,dd}]}`; lines without a
    `:` separator → paragraph rows; mixed content handled.
  - `kind: 'quote'` (voice) → `{kind:'quote', text}`.
  - `kind: 'paragraphs'` (notes) → split on `\n\n`, single `\n` preserved as breaks.
  - `detectPrice(line)` → splits a `$[\d,]+` span for `tabular-nums` emphasis (§6.2).
  - Empty / whitespace-only raw → `{kind:'empty'}`.
- **Implement:** `format.ts` with these pure functions only. No React, no DOM.
- **Run:** `npx vitest run apps/web/app/app/memory/format.test.ts` → green.
- **Commit:** `feat(memory): structural field formatters (list/dl/quote/paragraph)`.

### Task 4 — Field config + value-mirror helpers (`fields.ts`)
- **Test first:** `apps/web/app/app/memory/fields.test.ts`:
  - `FIELD_CONFIG` maps each key → `{ label, kind, placeholder, hint? }` for the 7 curated keys
    (facts, pricing, policies, faq, voice, hard_rules, notes); `kind` drives Task 3 formatting.
  - `mergeMirror(values, key, newValue)` → returns a new record with one key replaced (Option A).
  - `toRpcPayload(values)` → `{ sections, hard_rules[], notes }` reproducing today's `actions.ts`
    split (sections from MEMORY_SECTIONS keys; hard_rules split on `\n` filtered, ≤50; notes
    trimmed ≤8000). This is the pure core the server action will call.
- **Implement:** `fields.ts`. Re-export label/order consistent with `lib/grove/memory.ts`
  `MEMORY_SECTIONS` (do not duplicate-drift; import it).
- **Run / Commit:** green → `feat(memory): field config + Option-A mirror helpers`.

### Task 5 — `actions.ts`: partial-mirror save + `saveReference`
- **Test first:** `apps/web/app/app/memory/actions.test.ts` — unit-test the **payload builder**
  extracted in Task 4 (don't try to test the `'use server'` redirect/Supabase round-trip in vitest;
  assert that `toRpcPayload` produces the exact args `save_grove_memory` expects, and that
  `saveReference`'s input is trimmed/clamped to ≤8000).
- **Implement:** refactor `saveGroveMemory` to accept the full mirror as `FormData` (unchanged RPC
  call via `toRpcPayload`). Add `saveReference(formData)` → reads `reference`, clamps, calls
  `save_reference` RPC; returns/throws for the client to surface inline (no full-page redirect in
  per-field mode, §5.3). Keep the legacy `?saved=1` redirect path working for non-JS fallback.
- **Run / Commit:** green → `feat(memory): per-field mirror save + saveReference action`.

### Task 6 — `FieldView` component (formatted, locked display)
- **Test first:** `apps/web/app/app/memory/FieldView.test.tsx` via `renderToStaticMarkup`:
  - list kind → `<ul><li>` items; single item → `<p>`.
  - dl kind → `<dl><dt><dd>`.
  - quote kind → blockquote class with the text.
  - price line → a `tabular-nums` span around the number.
  - empty → faint placeholder text (`"Add your pricing…"`), no `<textarea>`.
- **Implement:** `FieldView.tsx` consuming the Task 3 descriptor. Token-only classes added to
  `memory.module.css` (`.fieldView`, `.dl`, `.quote`, `.list`, `.num`, `.placeholder`).
- **Run / Commit:** green → `feat(memory): FieldView formatted read rendering`.

### Task 7 — `FieldEditor` + edit-mode reducer (pure)
- **Test first:** two files.
  - `fieldEditor.reducer.test.ts`: pure reducer `editReducer(state, action)` for
    `enter | change | requestCancel | confirmCancel | requestClear | confirmClear | save` →
    asserts the `mode`, `dirty`, `confirming` flags. (This is the logic vitest *can* test without a
    DOM.)
  - `FieldEditor.test.tsx` (`renderToStaticMarkup`): renders a `<textarea>` with the raw value,
    `Save`/`Cancel` buttons, a `--coral-deep` "Clear field" tertiary link, the hint above, and
    `autoFocus`/`aria-describedby` wiring (§14).
- **Implement:** `fieldEditor.reducer.ts` (pure) + `FieldEditor.tsx` (presentational, driven by the
  reducer). Inline "Discard changes?" and "Clear [field]?" confirms are rendered conditionally from
  reducer flags, in an `aria-live="assertive"` region (§14), **not** a modal.
- **Run / Commit:** green → `feat(memory): FieldEditor + pure edit-mode reducer`.

### Task 8 — `FieldBlock` (view/edit toggle + provenance slot)
- **Test first:** `FieldBlock.test.tsx`: in view mode renders `FieldView` + an `Edit` button with
  `aria-label="Edit {label}"`; reserves a **fixed-height empty provenance slot** below the content
  (assert the slot element exists and is empty pre-F1 — no fabricated text, §11/§226). Given a
  `fieldMeta` prop it renders the provenance line (covered in Task 12).
- **Implement:** `FieldBlock.tsx` — owns `mode`/`localValue` `useState`, wires `FieldEditor`'s
  reducer, calls `onSave(field, value)` up to `MemoryClient`. CSS: `.field`, `.fieldHeader`,
  `.editBtn` (ghost, `--moss-deep`), `.provenanceSlot` (fixed `min-height`, prevents layout shift).
- **Run / Commit:** green → `feat(memory): FieldBlock view/edit toggle + provenance slot`.

### Task 9 — `HardRulesBlock` (coral authority treatment)
- **Test first:** `HardRulesBlock.test.tsx`: view mode renders the `HARD RULES` mono eyebrow in a
  `--coral-deep` class, the "Your Nibbins never break these" sub-label, each rule as `<li>` with the
  coral-square bullet class; the container carries the coral left-border class; empty → "No hard
  rules yet" faint + Edit. Edit mode → single textarea (one rule per line) keeping the coral accent
  and the hint copy above.
- **Implement:** `HardRulesBlock.tsx` + CSS (`.hardRules`, `.hardRulesEyebrow`, `.ruleBullet`,
  coral left border via `--coral-soft`/`--coral-deep` — soft coral, **not** the error coral, §7).
- **Run / Commit:** green → `feat(memory): HardRulesBlock coral authority treatment`.

### Task 10 — `EmptyState`, `FramingStrip`, `MemorySection`
- **Test first:** three small `renderToStaticMarkup` tests:
  - `EmptyState.test.tsx`: renders the egg-stage creature (`@nibbin/creatures`, aliased in
    `vitest.config.ts`), the two-line message, and two ghost chips
    (`Start with business facts`, `Set your voice`) carrying the field key they open (§9).
  - `FramingStrip.test.tsx`: renders the leaf glyph + "Your Nibbins read this as truth…" copy;
    a `hidden`/absent prop drops it (first-run & active-edit suppress it, §10).
  - `MemorySection.test.tsx`: heading + hint + ordered child field slots.
- **Implement:** the three components + CSS. Reuse the existing creature component; do not invent
  art.
- **Run / Commit:** green → `feat(memory): empty state, framing strip, memory section`.

### Task 11 — `TabBar` + `MemoryClient` shell (truth tab assembled)
- **Test first:**
  - `tabBar.logic.test.ts`: pure `nextTab(current, key)` + `tabProps` builder (`role="tab"`,
    `aria-selected`, arrow-key index math) — §14 tablist semantics tested as logic.
  - `MemoryClient.test.tsx` (`renderToStaticMarkup`, default `tab='memory'`): renders the two tabs,
    the framing strip, both `MemorySection`s in spec order (About your business → Voice & rules),
    `HardRulesBlock`, and on `isEmpty` renders `EmptyState` instead of the sections.
- **Implement:** `TabBar.tsx`, `GroveMemoryTab.tsx`, `MemoryClient.tsx`. `MemoryClient` holds the
  `values` mirror + active tab; passes `onSave`/`onSaveReference` down. Rewire `page.tsx` to fetch
  `reference_text` and render `<MemoryClient … />` (drop the server `<form>`). Keep `force-dynamic`
  + the onboarding seed for `facts`.
- **Run / Commit:** green → `feat(memory): TabBar + MemoryClient shell, truth tab assembled`.

### Task 12 — Provenance / staleness line (F1-gated, graceful empty)
- **Test first:** `provenance.test.ts` (pure):
  - `sourceLabel('field_study') → "From Field Study"`, `'connector:gmail' → "From Gmail"`,
    `'user_entered' → "You wrote this"`, `'seeded' → "From your onboarding"`, unknown → null.
  - `staleness(lastReviewedAt, now)` → `{ stale:boolean, text:string }`; `> STALE_DAYS` (const, 60)
    flips `stale:true` and the "— worth a check?" copy; the line uses `--honey-deep` (amber) when
    stale, `--ink-faint` `--mono` otherwise (§11/§230).
  - `null`/absent meta → renders nothing (silence, not "unknown").
- **Implement:** `provenance.ts` + render the line inside `FieldBlock`'s reserved slot when a
  `fieldMeta[key]` prop is present. `page.tsx`: if the F1 `field_meta` table exists (try/catch the
  select, like `loadGroveMemoryBlock` guards the table), pass `fieldMeta`; else pass `undefined`.
- **Run / Commit:** green → `feat(memory): provenance + staleness line (F1-gated, empty pre-F1)`.

### Task 13 — `SourcesTab`: Reference catch-all (live) + EvidenceList (gated)
- **Test first:**
  - `ReferenceCatchAll.test.tsx`: labelled "Reference material — overflow context…"; view mode
    renders the value as `<pre>` (no structural formatting, §8.1) with a "Show all"/"Collapse"
    affordance when long; edit mode → textarea bound to the **new `reference_text`** value, saving
    via `saveReference`. Empty → the §14.5 nudge copy ("Don't want to type it all out? Drop in a
    doc…").
  - `EvidenceList.test.tsx`: with `SOURCES_ENABLED` false / no F1 tables → the honest empty banner
    ("Evidence attaches automatically when the Foundation is live…", §8.2), `--understory` bg, no
    spinner; with evidence rows present → grouped source cards (type label, excerpt, `Last seen`).
    The component must **not** import any F1 table type at module scope (build-safe pre-F1).
- **Implement:** `SourcesTab.tsx`, `ReferenceCatchAll.tsx`, `EvidenceList.tsx`. Gate the evidence
  list on `process.env.SOURCES_ENABLED === 'true'` AND presence of passed-in rows; default empty
  banner otherwise. `SourcesTab` framing copy from §14.5.
- **Run / Commit:** green → `feat(memory): Sources tab — Reference catch-all + gated evidence list`.

### Task 14 — Motion + a11y polish + reduced-motion
- **Test first:** assert (in the relevant component static-markup tests, extended) the presence of
  the motion classes and the `aria-live` region; assert `role="tablist"`/`role="tab"` on the TabBar
  markup. (Animation timing itself isn't unit-tested — covered by the reduced-motion global rule.)
- **Implement:** view↔edit crossfade via the `grid-template-rows: 0fr→1fr` pattern (§13, already
  used in the Keeper dock); tab fade; inline-confirm fade. Confirm `globals.css`
  `prefers-reduced-motion` collapses these. Move focus to textarea on edit-open; return focus to the
  Edit button on close (document the handler; logic-level only in vitest).
- **Run / Commit:** green → `feat(memory): motion + a11y polish for memory redesign`.

### Task 15 — Full gate + cleanup
- **Run:** `npx vitest run apps/web/app/app/memory` (all unit/component) +
  `npx vitest run tests/rls/grove-memory-reference.test.ts` (live PG) +
  `npm run lint` + `npm run typecheck` — all green.
- **Verify** `loadGroveMemoryBlock` and `MEMORY_SECTIONS` are byte-for-byte unchanged (spec §15);
  grep for any accidental import drift.
- **Commit:** `chore(memory): green gate — lint, typecheck, unit, RLS`.
- **Then** request the adversarial 4-reviewer gate (this is a sensitive curated-data surface;
  `adversarial-gate.yml` runs on it) and open the PR `--base main` after rebasing on latest.

---

## Risks / forks for the human

1. **Rebase ordering.** F1 (`feature/company-brain-foundation`) must merge or be rebased onto
   first for provenance + evidence to be real. The plan builds them as graceful-empty stubs so it
   is *safe* to ship P1 before F1 — but if F1 is close, rebasing first avoids a second pass.
2. **`reference_text` doubles the catch-all.** Decision is locked (separate column), which **reverses
   spec Fork 3**. Consequence: "Anything else" (`notes`) and "Reference" are now two distinct
   stores. Confirm the product copy distinguishes them clearly so users don't wonder which to use —
   `notes` = short curated aside on the truth tab; `reference_text` = long raw dump on Sources.
   (Note: `loadGroveMemoryBlock` currently injects `notes` but **not** `reference_text`; this plan
   does not change that. **Fork for human:** should Reference material also be fed to the drafter?
   If yes, that's a follow-up to `lib/grove/memory.ts` — out of scope here per §15.)
3. **No jsdom in this repo.** Click→state transitions can't be asserted in vitest. The plan
   mitigates by extracting all interaction logic into pure reducers/helpers (Tasks 4, 7, 11, 12) and
   testing components via static markup. True interaction coverage would need a Playwright/e2e pass
   — recommended post-merge, not blocking.
4. **Migration timing.** The `reference_text` migration is additive + nullable, safe to apply to all
   three DBs before code ships, but it **must** be applied to dev/staging/prod (per
   `reference_supabase_instances.md`) or the Sources Reference save will 404 the RPC in any env
   that's behind.
5. **`SOURCES_ENABLED` flag.** EvidenceList is env-gated. Confirm the flag default is `false`
   everywhere until F1's tables exist, so no half-built evidence UI leaks to prod.
