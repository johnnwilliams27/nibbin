# Memory: General + Extensible Fields, and Sources File Library (P1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the photographer-flavored fixed field set with a neutral, user-extensible section model, and turn the Sources tab into a real file library (drag-drop, list, search/filter/sort).

**Architecture:** `grove_memory.sections` stays an open JSONB map; section identity/order/visibility moves to an extended `field_meta` table, so the field registry becomes data-driven (defaults ∪ custom) and seedable. Two new security-definer RPCs own custom-section structure; a new `GET /api/brain/sources` read API backs the library list. All UI stays client-safe and tested via `renderToStaticMarkup` + pure reducers.

**Tech Stack:** Next.js 15 (App Router, RSC), TypeScript, Supabase/Postgres 17, vitest, `tests/rls` live-Postgres harness.

## Global Constraints

- **Max 40 total sections per account.** Label ≤ **60** chars. Custom `field_key` matches `^c_[a-z0-9_]{1,40}$` (server-generated from the label; never client-supplied raw).
- **RPCs are the ONLY write path.** Every new RPC: `security definer`, `set search_path=''`, `auth.uid()` not-null check, `private.is_account_member(target_account)` re-check, `pg_advisory_xact_lock(hashtext('grove_memory:'||account))`, `grove_memory.version` bump, append to `grove_memory_history`. Grants: `authenticated` only; `revoke execute … from public, anon, service_role`.
- **`hard_rules` stays a separate RPC param** (not a section). The coral HardRulesBlock is unchanged.
- The dynamic field registry MUST stay **guard-free / client-safe** (no `server-only` import) — it is imported by client components. Follow the existing `lib/grove/memory-sections.ts` pattern.
- **PostgREST resolves RPC args by NAME** — every action test asserts the exact arg keys the client sends match the SQL param names (bidirectional), the regression class that bit P1/P2.
- This P1 migration OWNS the ALTER of BOTH `field_meta` AND `sources` (P2 only writes the `sources` columns).
- Non-destructive back-compat: legacy `facts` value forward-maps to `about` on read when `about` is empty; old key retained.

---

### Task 1: Migration — extend `field_meta` and `sources`

**Files:**
- Create: `apps/web/../supabase/migrations/20260623130000_memory_extensible_and_sources_library.sql` (path: `supabase/migrations/` at repo root)
- Test: `tests/rls/memory-extensible.schema.test.ts`

**Interfaces:**
- Produces: new columns `field_meta.label text`, `field_meta.sort_order integer not null default 1000`, `field_meta.is_custom boolean not null default false`, `field_meta.is_hidden boolean not null default false`; `sources.mime_type text`, `sources.byte_size bigint`, `sources.extraction_state text not null default 'pending'`.

- [ ] **Step 1: Write the failing schema test**

```ts
// tests/rls/memory-extensible.schema.test.ts
import { describe, it, expect } from 'vitest';
import { RlsHarness } from './_harness'; // match the existing import path used by other tests/rls files

describe('migration: field_meta + sources columns', () => {
  it('field_meta has label/sort_order/is_custom/is_hidden', async () => {
    const h = await RlsHarness.boot();
    const cols = await h.sql(`select column_name from information_schema.columns
      where table_schema='public' and table_name='field_meta'`);
    const names = cols.map((r: { column_name: string }) => r.column_name);
    expect(names).toEqual(expect.arrayContaining(['label', 'sort_order', 'is_custom', 'is_hidden']));
  });
  it('sources has mime_type/byte_size/extraction_state with a CHECK on extraction_state', async () => {
    const h = await RlsHarness.boot();
    const cols = await h.sql(`select column_name from information_schema.columns
      where table_schema='public' and table_name='sources'`);
    const names = cols.map((r: { column_name: string }) => r.column_name);
    expect(names).toEqual(expect.arrayContaining(['mime_type', 'byte_size', 'extraction_state']));
  });
});
```

> Read an existing `tests/rls/*.test.ts` first to match the real harness boot/import API (`RlsHarness` shape may differ — use the project's actual entry point; do not invent methods).

- [ ] **Step 2: Run it, expect FAIL** (columns absent). `npx vitest run tests/rls/memory-extensible.schema.test.ts`

- [ ] **Step 3: Write the migration**

```sql
-- 20260623130000_memory_extensible_and_sources_library.sql
-- Extends Foundation's field_meta with section identity/order/visibility (custom
-- + renamed/hidden defaults), and sources with file metadata + extraction state
-- for the Sources file library. Purely additive; nullable or defaulted columns.

alter table public.field_meta
  add column label      text    check (label is null or char_length(label) <= 60),
  add column sort_order integer not null default 1000,
  add column is_custom  boolean not null default false,
  add column is_hidden  boolean not null default false;

alter table public.sources
  add column mime_type       text   check (mime_type is null or char_length(mime_type) <= 255),
  add column byte_size       bigint check (byte_size is null or byte_size >= 0),
  add column extraction_state text not null default 'pending'
    check (extraction_state in ('pending','extracting','extracted','unsupported','failed'));

create index sources_account_state_idx on public.sources (account_id, extraction_state);
```

- [ ] **Step 4: Apply to the local harness DB + run test, expect PASS.** (The `tests/rls` harness applies migrations on boot; if it needs an explicit step, follow the existing convention.)

- [ ] **Step 5: Commit** — `git add supabase/migrations/20260623130000_*.sql tests/rls/memory-extensible.schema.test.ts && git commit -m "feat(memory): migration — extensible field_meta + sources library columns"`

---

### Task 2: RPC `upsert_section_meta` (create/rename/reorder/hide)

**Files:**
- Modify: the same migration file from Task 1 (append the function), OR a sibling migration `20260623130500_section_meta_rpcs.sql`. Prefer appending to keep one migration per concern.
- Test: `tests/rls/section-meta.rpc.test.ts`

**Interfaces:**
- Produces SQL: `upsert_section_meta(target_account uuid, p_field_key text, p_label text, p_sort_order integer, p_is_custom boolean, p_is_hidden boolean) returns void`.

- [ ] **Step 1: Write failing RLS tests** covering: (a) a member can upsert a custom section row; (b) the 40-section cap raises when exceeded; (c) a non-member is rejected; (d) custom `field_key` not matching `^c_[a-z0-9_]{1,40}$` AND `p_is_custom=true` raises; (e) re-upsert (rename) updates `label`/`sort_order` and bumps `grove_memory.version`; (f) a `grove_memory_history` row is appended with `change_source='manual'`.

```ts
// shape (fill assertions against the real harness API):
it('rejects when total section count would exceed 40', async () => {
  const h = await RlsHarness.boot();
  const acct = await h.seedAccountWithMember();
  // seed 40 custom rows, then expect the 41st to throw
  await expect(h.as(acct.member).rpc('upsert_section_meta', {
    target_account: acct.id, p_field_key: 'c_overflow', p_label: 'Overflow',
    p_sort_order: 9999, p_is_custom: true, p_is_hidden: false,
  })).rejects.toThrow(/section limit|too many sections/i);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement the RPC**

```sql
create function public.upsert_section_meta(
  target_account uuid,
  p_field_key    text,
  p_label        text,
  p_sort_order   integer,
  p_is_custom    boolean,
  p_is_hidden    boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  existing_count integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not (select private.is_account_member(target_account)) then
    raise exception 'not a member of this account';
  end if;
  if p_is_custom and p_field_key !~ '^c_[a-z0-9_]{1,40}$' then
    raise exception 'invalid custom field key';
  end if;
  if p_label is not null and char_length(p_label) > 60 then
    raise exception 'label too long';
  end if;

  perform pg_advisory_xact_lock(hashtext('grove_memory:' || target_account::text));

  -- enforce 40-section cap on NEW custom rows only
  if p_is_custom and not exists (
    select 1 from public.field_meta
     where account_id = target_account and field_key = p_field_key
  ) then
    select count(*) into existing_count from public.field_meta
      where account_id = target_account and is_custom and not is_hidden;
    if existing_count >= 40 then
      raise exception 'section limit reached (max 40)';
    end if;
  end if;

  insert into public.field_meta (account_id, field_key, label, sort_order, is_custom, is_hidden)
    values (target_account, p_field_key, p_label, coalesce(p_sort_order, 1000), p_is_custom, p_is_hidden)
  on conflict (account_id, field_key) do update
    set label      = excluded.label,
        sort_order = excluded.sort_order,
        is_hidden  = excluded.is_hidden;

  update public.grove_memory set version = version + 1, updated_at = now()
    where account_id = target_account;

  insert into public.grove_memory_history
    (account_id, field_key, old_value, new_value, version, change_source, changed_by)
  values (target_account, p_field_key, null, coalesce(p_label, p_field_key),
          coalesce((select version from public.grove_memory where account_id = target_account), 1),
          'manual', uid);
end;
$$;
revoke execute on function public.upsert_section_meta(uuid, text, text, integer, boolean, boolean) from public, anon, service_role;
grant execute on function public.upsert_section_meta(uuid, text, text, integer, boolean, boolean) to authenticated;
```

- [ ] **Step 4: Run tests, expect PASS.**
- [ ] **Step 5: Commit.**

---

### Task 3: RPC `delete_custom_section`

**Files:** append to the migration; Test: `tests/rls/section-meta-delete.rpc.test.ts`

**Interfaces:** Produces `delete_custom_section(target_account uuid, p_field_key text) returns void`.

- [ ] **Step 1: Failing tests** — (a) member deletes a custom section: its `field_meta` row is gone AND its `sections` key is removed from `grove_memory`; (b) attempting to delete a DEFAULT key (e.g. `voice`, not matching the custom regex) raises; (c) non-member rejected; (d) `grove_memory.version` bumped + history appended.
- [ ] **Step 2: Run, FAIL.**
- [ ] **Step 3: Implement** — guard `p_field_key ~ '^c_[a-z0-9_]{1,40}$'` else `raise exception 'not a custom section'`; advisory lock; `delete from field_meta …`; `update grove_memory set sections = sections - p_field_key, version = version + 1, updated_at = now()`; append history (`change_source='manual'`). Same grant/revoke posture.
- [ ] **Step 4: PASS.** **Step 5: Commit.**

---

### Task 4: Dynamic field registry (defaults ∪ field_meta; neutral copy; legacy facts→about)

**Files:**
- Modify: `apps/web/lib/grove/memory-sections.ts` (neutral default registry — keep guard-free)
- Create: `apps/web/app/app/memory/registry.ts` (pure merge of defaults + field_meta rows → ordered render list)
- Modify: `apps/web/app/app/memory/fields.ts` (FIELD_CONFIG built from the dynamic registry; neutral placeholders; `toRpcPayload` iterates the dynamic key set, not a fixed five)
- Test: `apps/web/app/app/memory/registry.test.ts`, extend `fields.test.ts`

**Interfaces:**
- Produces: `DEFAULT_SECTIONS: ReadonlyArray<{key,label,kind,placeholder,hint?}>` with the 8 neutral keys from spec §A.1 (`about, offering, how, pricing, policies, voice, faq` + `hard_rules`/`notes` handled as today). `buildSectionRegistry(metaRows): SectionDescriptor[]` merging defaults with `field_meta` overrides (rename via `label`, reorder via `sort_order`, drop via `is_hidden`) and appending custom rows ordered by `sort_order`. `forwardMapLegacy(values): values` copying `facts`→`about` when `about` empty.

- [ ] **Step 1: Failing tests** for `buildSectionRegistry`:
  - defaults render in canonical order when no meta rows;
  - a meta row `{field_key:'voice', label:'House voice', sort_order:1}` renames+moves `voice` to the front;
  - a meta row `{field_key:'policies', is_hidden:true}` drops `policies`;
  - a custom row `{field_key:'c_brand', label:'Brand guidelines', is_custom:true, sort_order:500}` appears with that label;
  - never emits `hard_rules`/`notes` as sections (they remain separate).
  And for `forwardMapLegacy`: `{facts:'X'}` → `about:'X'`; if `about` already set, `facts` is ignored.
- [ ] **Step 2: Run, FAIL.**
- [ ] **Step 3: Implement.** Rewrite `DEFAULT_SECTIONS` with neutral copy (no "deposits"/photography). Example placeholders: `pricing` → `"Standard plan: $X / month\nSetup fee: $Y\nNet-30 terms"`; `about` → `"Who you are, what you make or do, who you serve."`. `toRpcPayload` builds `sections` by iterating `[...defaultKeys, ...customKeysFromMeta]` instead of `MEMORY_SECTIONS`.
- [ ] **Step 4: PASS.** **Step 5: Commit.**

---

### Task 5: Section-meta server actions

**Files:**
- Modify: `apps/web/app/app/memory/actions.ts` (add `saveSectionMeta(formData)` and `deleteSection(formData)`)
- Test: extend `apps/web/app/app/memory/actions.test.ts`

**Interfaces:** Consumes the slug helper (Task 4) + RPCs (Tasks 2/3). Produces `saveSectionMeta(fd): Promise<{ok:true}|{ok:false,error}>` calling `upsert_section_meta` with arg keys EXACTLY `{ target_account, p_field_key, p_label, p_sort_order, p_is_custom, p_is_hidden }`; `deleteSection(fd)` calling `delete_custom_section` with `{ target_account, p_field_key }`.

- [ ] **Step 1: Failing tests** — assert the rpc spy is called with `save_grove_memory`-style EXACT arg-name shape (bidirectional: list the expected keys and assert `Object.keys(args).sort()` equals them); per-field inline return (`{ok:true}` / `{ok:false,error}`), no redirect; custom key is server-slugged from the label (e.g. label "Brand Guidelines!" → `c_brand_guidelines`).
- [ ] **Step 2: FAIL. Step 3: Implement** (slug: lowercase, non-alnum→`_`, collapse, trim, prefix `c_`, clamp 40). **Step 4: PASS. Step 5: Commit.**

---

### Task 6: Add / rename / reorder / remove UI

**Files:**
- Create: `apps/web/app/app/memory/sectionControls.reducer.ts` (pure state machine for the add/rename/reorder/remove interactions)
- Create: `apps/web/app/app/memory/AddSectionControl.tsx`, `apps/web/app/app/memory/SectionActions.tsx`
- Modify: `apps/web/app/app/memory/MemoryClient.tsx` (render the dynamic registry; wire controls), `page.tsx` (load `field_meta` rows incl. new columns; pass registry down), `memory.module.css` (styles for the controls — follow existing tokens)
- Test: `sectionControls.reducer.test.ts`, render tests for the two components via `renderToStaticMarkup`

**Interfaces:** Consumes `buildSectionRegistry`, `saveSectionMeta`, `deleteSection`. The reducer handles `START_ADD`, `EDIT_LABEL`, `MOVE_UP/DOWN` (computes new `sort_order` values), `CONFIRM_REMOVE`, `CANCEL` — all pure, returning new state + the action payload to submit.

- [ ] **Step 1: Failing reducer tests** — MOVE_UP swaps sort_order with the previous sibling; CONFIRM_REMOVE on a default sets `is_hidden:true` (not delete) while on a custom calls delete; adding requires a non-empty label.
- [ ] **Step 2: FAIL. Step 3: Implement** reducer + components; render tests assert the "+ Add a section" control and per-field actions appear only in edit context (view mode stays clean). MemoryClient maps over the registry instead of `CURATED_FIELD_KEYS`.
- [ ] **Step 4: PASS. Step 5: Commit.**

---

### Task 7: Neutral copy sweep + page wiring

**Files:** Modify `page.tsx` (the `seedSectionsFromAnswers` "facts" seed → seed `about`; load field_meta new cols via the existing `loadFieldMeta`/a sibling query), `MemoryClient.tsx`, `memory-sections.ts` labels, any onboarding-facing copy in the memory surface. Test: render test asserting no photographer-specific strings ("deposit", "session", "shoot") remain in default placeholders/labels.

- [ ] **Step 1: Failing test** grepping the rendered default registry + placeholders for forbidden substrings → expect none. **Step 2: FAIL. Step 3: Implement. Step 4: PASS. Step 5: Commit.**

---

### Task 8: `GET /api/brain/sources` read API (query/format pure core + route)

**Files:**
- Create: `apps/web/app/app/memory/sourcesQuery.ts` (pure: parse search/filter/sort params → a normalized query descriptor; map a `sources` row → a `SourceListItem` view model incl. type-group + state chip)
- Create: `apps/web/app/api/brain/sources/route.ts` (`GET`, member-scoped via `appSession`, paginated; applies the descriptor to a Supabase query over `sources`; title search always, content search via P5 `match_sources`/`source_chunks` when a `q` is present and FTS is available — degrade to title-only on error)
- Test: `sourcesQuery.test.ts`, `apps/web/app/api/brain/sources/route.test.ts` (mocked Supabase)

**Interfaces:** Produces `SourceListItem = { id, title, mimeGroup: 'docs'|'images'|'sheets'|'slides'|'web'|'other', byteSize, capturedAt, extractionState }`; `parseSourcesParams(searchParams): { q, group, state, sort, dir, limit, offset }` with safe defaults (`sort='captured_at'`, `dir='desc'`, `limit=50`); `mimeToGroup(mime, filename): mimeGroup`.

- [ ] **Step 1: Failing tests** — `mimeToGroup('image/png')==='images'`, `'application/pdf'==='docs'`, xlsx→`'sheets'`, pptx→`'slides'`, `text/html`→`'web'`, unknown→`'other'`; param parsing clamps limit ≤ 100 and rejects unknown sort columns (falls back to `captured_at`); route returns 401 without a session and member-scoped rows with one.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS. Step 5: Commit.**

---

### Task 9: Sources library UI (drag-drop + list + search/filter/sort)

**Files:**
- Create: `apps/web/app/app/memory/SourcesLibrary.tsx` (replaces/extends the current Sources tab body: drag-drop zone posting to `POST /api/brain/documents/upload`, the file list, the search box + filter chips + sort control)
- Create: `apps/web/app/app/memory/sourcesLibrary.reducer.ts` (pure: holds `{q, group, state, sort, dir, items, uploading}`; actions `SET_QUERY/SET_FILTER/SET_SORT/UPLOAD_START/UPLOAD_DONE/LOAD_OK`)
- Create: `apps/web/app/app/memory/SourceRow.tsx` (type icon + title + size + date + state chip)
- Modify: the Sources tab in `MemoryClient.tsx` to mount `SourcesLibrary` above the existing Reference catch-all (Reference unchanged)
- Test: `sourcesLibrary.reducer.test.ts`, render tests for `SourceRow` + `SourcesLibrary` (empty, populated, uploading, "not yet read" state) via `renderToStaticMarkup`

**Interfaces:** Consumes `SourceListItem` + `parseSourcesParams` shape (Task 8). The drag-drop handler is a thin client fetch to the upload endpoint; the reducer owns all sort/filter/search state transitions (pure, unit-tested) so the component is a dumb renderer.

- [ ] **Step 1: Failing reducer tests** — SET_FILTER('images') narrows the derived list; SET_SORT toggles dir on repeat; UPLOAD_START sets `uploading=true` and UPLOAD_DONE prepends the new item with `extractionState:'pending'`.
- [ ] **Step 2: FAIL. Step 3: Implement** (drag-drop zone uses native DnD + a file input fallback; the state chip maps `extracted→"Read"`, `extracting→"Reading…"`, `unsupported→"Retained — not yet read"`, `failed→"Couldn't read"`, `pending→"Queued"`). **Step 4: PASS. Step 5: Commit.**

---

### Task 10: Full-suite green + provenance/staleness intact

- [ ] Run `npm run lint`, `npm run typecheck`, and the memory + tests/rls suites; fix any breakage. Confirm the coral HardRulesBlock, Reference catch-all, and provenance slot still render. Commit `chore: typecheck + lint + suite green (memory extensible + sources library)`.

---

## Self-review notes
- Spec coverage: A.1 (Task 4/7), A.2 (Tasks 1-3,6), A.3 (Tasks 2,3,5), A.4 (Task 4), A.5 (Task 6), B.3 (Tasks 8-9). ✓
- `hard_rules`/`notes` never enter the dynamic section set (Task 4 test guards it). ✓
- Migration ownership: both ALTERs here; P2 only writes `sources` cols. ✓
- Arg-name regression guard present in Tasks 2,3,5. ✓
