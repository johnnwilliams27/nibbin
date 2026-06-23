# Memory: General + Extensible Fields, and Sources as a File Library — Design

> Refinement of the Company Brain wave (chunks P1 + P2), folded in **before merge**.
> Supersedes the photographer-flavored field model in the P1 design and the
> text-only/image-rejecting extraction posture in the P2 design.

**Date:** 2026-06-23
**Branches touched:** `feature/company-brain-memory-redesign` (P1) and
`feature/company-brain-docs-ingest` (P2) — both still open PRs (#242, #245),
updated in place.

---

## Why

The redesigned Memory page is faithful to the *old* solo-creative product: a
fixed set of photographer-flavored fields (deposits, sessions) and a closed
schema. The repositioning (a work tool for one person *or* a 10,000-person org)
requires two things the current build lacks:

1. **General, user-extensible curated fields** — neutral defaults plus the
   ability to define your own information headers and content. Designed so a
   future org can seed a template of sections across many accounts.
2. **Sources as a real file library** — drag-and-drop upload of *any* file
   type, retained and searchable/filterable/sortable, with OCR/vision
   extraction so images and scanned documents (not just text docs) can propose
   memory updates.

---

## Workstream A — General + extensible Memory fields (P1 worktree)

### A.1 Neutral starter set

Replace the photographer schema with eight universal fields whose copy and
placeholders read sensibly for a solo founder *or* an enterprise ops team:

| field_key   | Label             | Format hint        | Replaces / notes                         |
|-------------|-------------------|--------------------|------------------------------------------|
| `about`     | About us          | paragraphs         | new (who/what the org is)                |
| `offering`  | What we do        | paragraphs/list    | new (products/services)                  |
| `how`       | How we work       | list               | new (process, hours, turnaround)         |
| `pricing`   | Pricing & terms   | list               | renamed from photographer "Pricing"; copy de-flavored (no "deposits") |
| `policies`  | Policies          | list               | kept, neutral copy                       |
| `voice`     | Voice & tone      | quote              | kept                                     |
| `faq`       | Common questions  | list               | kept (was `faq`)                         |
| `hard_rules`| Hard rules        | coral authority    | kept; remains the separate `hard_rules` RPC param, NOT a section |

Legacy keys (`facts`) are migrated forward (see A.4). `notes` stays the
free-text "Anything else" catch-all.

### A.2 User-defined sections

A **"+ Add a section"** control lets the owner create a custom field: they name
the header and add content. Existing sections (default *and* custom) can be
**renamed, reordered, and removed** (removing a default hides it without
destroying any stored value).

**Storage model (extends Foundation, no new table):**

`grove_memory.sections` is already an open `{key: value}` JSONB map — custom
sections are additive keys. Presentation/identity for *all* sections lives in
`field_meta`, extended with:

```sql
alter table public.field_meta
  add column label      text,                 -- display label override (custom + renamed defaults)
  add column sort_order integer not null default 1000,
  add column is_custom  boolean not null default false,
  add column is_hidden  boolean not null default false;
-- label length + custom-key format guarded by CHECKs (see plan).
```

- **Defaults**: known `field_key`s render with built-in labels/order unless a
  `field_meta` row overrides (rename → `label`; reorder → `sort_order`; remove
  → `is_hidden = true`).
- **Custom**: `field_meta` row with `is_custom = true`, a `label`, a
  `sort_order`, and a slugged `field_key` (e.g. `c_brand_guidelines`). Its value
  lives in `sections[field_key]`.
- **Seedable**: because identity is data (not code), a future org-admin flow can
  insert `field_meta` rows + `sections` defaults across many accounts. **We
  build the model to allow it; we do NOT build the cross-account seeding UI now**
  (B2B/multi-user phase).

### A.3 Writes

A single security-definer RPC owns custom-section structure (mirrors
`save_grove_memory` posture: `security definer`, `set search_path=''`,
`auth.uid()` + `is_account_member` re-check, advisory lock, version bump,
append to `grove_memory_history`):

- `upsert_section_meta(target_account, field_key, label, sort_order, is_custom, is_hidden)`
  — create/rename/reorder/hide a section's metadata.
- `delete_custom_section(target_account, field_key)` — hard-remove a *custom*
  section (rejects default keys; clears its `sections` value + `field_meta` row).
- Section **value** writes continue through the existing `save_grove_memory`
  full-mirror path (now mirrors the dynamic key set, not a fixed seven).

Bounds: max **40** total sections per account; label ≤ 60 chars; custom
`field_key` matches `^c_[a-z0-9_]{1,40}$` (server-generated from the label).

### A.4 Migration & back-compat

- Forward-map the legacy `facts` value into `about` on first read if `about` is
  empty (non-destructive; old key retained).
- `MEMORY_SECTIONS` (the client field registry) becomes **dynamic** — derived
  from `field_meta` ∪ the default registry, not a hardcoded list. The
  guard-free `lib/grove/memory-sections.ts` extraction stays.
- Coral `hard_rules` and the Reference catch-all are unchanged.

### A.5 UI

- View mode unchanged in spirit (locked, formatted, per-field Edit).
- New: **"+ Add a section"** affordance at the bottom of each group; an
  inline **rename / move up / move down / remove** affordance per field
  (revealed in edit context, not cluttering view mode).
- Empty custom section shows the same empty-state pattern.

---

## Workstream B — Sources file library (P1 UI + P2 extraction)

### B.1 Store every file type (P2 upload route)

- Drop the image rejection. Accept **any** file up to the 20 MB cap; the
  original is always stored in `brain-sources` and a `sources` row
  (`kind='document'`) is created **regardless of whether we can extract it yet**.
- Add typed columns to `sources` for the library list (filter/sort without
  unpacking `origin`):

```sql
alter table public.sources
  add column mime_type text check (mime_type is null or char_length(mime_type) <= 255),
  add column byte_size bigint check (byte_size is null or byte_size >= 0),
  add column extraction_state text not null default 'pending'
    check (extraction_state in ('pending','extracting','extracted','unsupported','failed'));
```

- A file we cannot extract is stored with `extraction_state='unsupported'` and
  shows an **"original retained — not yet read"** state in the UI. Never
  silently dropped.

### B.2 OCR / vision extraction (P2 worker + router)

`doc-extract.ts` routes by type to a per-kind extractor:

| Kind                              | Extractor                                  | Phase |
|-----------------------------------|--------------------------------------------|-------|
| text-native (txt, md, csv, html)  | direct decode + strip                      | 1     |
| docx                              | mammoth (existing)                         | 1     |
| pdf (text layer)                  | pdf-parse (existing)                        | 1     |
| **image (png, jpg, webp, svg→raster)** | **vision (multimodal router)**       | 1     |
| **pdf (scanned / no text layer)** | **vision OCR fallback**                    | 1     |
| pptx                              | text-per-slide parser (+ vision per slide) | 2     |
| xlsx                              | sheet/table text extract                   | 2     |

**Router multimodal extension** (`@nibbin/router`) — the deferred dependency:
extend the `generate` path so a message's `content` may be an array of typed
blocks (`{type:'text'}` and `{type:'image', source:{type:'base64', media_type, data}}`)
instead of only a string. Anthropic's `/v1/messages` already accepts this; the
seam is `ChatTurn.content` + `anthropic.ts` block mapping. Text-only callers are
unchanged (string still accepted). Cost/budget accounting flows through the same
path. Fail-closed preserved: vision output is **derived-not-raw**, enters the
**proposal queue** (`propose_memory_change`, 8-arg with `p_stakes`), and is never
a direct write.

**Sequencing (honest):** Phase 1 (text-native + docx + pdf-text + **images +
scanned-PDF vision**) ships with this batch. Phase 2 (pptx/xlsx parsing) follows;
until then those types are stored as `unsupported` (retained + searchable by
name), not rejected.

### B.3 Library UI (P1 Sources tab)

- **Drag-and-drop** upload zone (supersedes the standalone P2 card; posts to the
  existing `POST /api/brain/documents/upload`).
- **File list** — one row per source: type icon, title, size, captured date,
  extraction-state chip (`read` / `reading…` / `not yet read` / `failed`).
- **Search** — by title + extracted content (content search via P5's
  `match_sources` / `source_chunks` FTS where indexed; title always).
- **Filter** — by type group (docs / images / sheets / slides / web / other)
  and by extraction state.
- **Sort** — captured date (default desc), title, size, type.
- New read API: `GET /api/brain/sources?…` (member-scoped, paginated) backing
  the list/search/filter/sort. Pure query/format logic unit-tested; RLS via the
  account-member policy.

---

## Boundaries / non-goals

- No cross-account/org template seeding UI (model only; B2B phase).
- No pptx/xlsx *parsing* in Phase 1 (stored as `unsupported`).
- Reference catch-all, coral hard-rules, provenance/staleness slots unchanged.
- The conflict/source-authority engine (C2) is still a separate follow-on.

## Integration points (merge checklist additions)

- P1's Sources tab calls P2's `documents/upload` endpoint — both branches must
  land together (already the case; Foundation #240 first, then the wave).
- `field_meta` ALTER (A.2) and `sources` ALTER (B.1) are **new migrations** on
  the P1 / P2 branches respectively; apply to all 3 DBs at merge.
- Router multimodal change is backward-compatible (string content still valid),
  so existing P2/P3/P5 router callers are unaffected.

## Testing posture

Follows the repo harness: pure logic (field registry merge, slug, sort/filter,
query builders) unit-tested; components via `renderToStaticMarkup`; RPCs +
RLS via the `tests/rls` live-Postgres harness with bidirectional RPC arg-name
assertions (the named-arg mismatch class that bit P1/P2 before). Migrations
applied to dev/staging/prod at merge with prod confirmation.
