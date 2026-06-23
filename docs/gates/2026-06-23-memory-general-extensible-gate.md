# Whole-branch adversarial gate — Memory general+extensible + Sources library

- **Branch:** `feature/company-brain-memory-redesign` (worktree `C:\nib-p1`)
- **Scope:** Workstream A (general+extensible Memory fields) + B.3 (Sources file library)
- **Spec:** `docs/superpowers/specs/2026-06-23-memory-general-extensible-and-sources-library-design.md`
- **Migration under review:** `supabase/migrations/20260623130000_memory_extensible_and_sources_library.sql`
- **Date:** 2026-06-23

## Verdict: PASS-WITH-MINOR

No Critical or Important defects block the merge. The two security-definer RPCs are correctly hardened, the read API is member-scoped via RLS, and the "fresh-account renders neutral defaults / no photographer copy" claim is TRUE in the real render path. Several real-but-bounded correctness gaps (slug collision, client-side filtering over a server-capped result, `group='other'` route no-op) should be tracked; only the slug collision rises to "Important" by data-integrity standard, but its blast radius is one account's own sections (self-inflicted, recoverable), so it lands as a strong Minor/should-fix rather than a blocker.

Counts: **Critical 0 · Important 1 · Minor 4**

---

## Lens 1 — Red-team / security (RLS + write path)

### PASS — both RPCs gate on auth.uid() + membership before any write
`upsert_section_meta` (migration L36-39) and `delete_custom_section` (L105-108) both:
- raise on `auth.uid() is null` FIRST,
- then `private.is_account_member(target_account)` BEFORE any insert/update/delete,
- both `security definer set search_path = ''`,
- both take `pg_advisory_xact_lock(hashtext('grove_memory:'||target_account))` (L47 / L113),
- both `revoke execute ... from public, anon, service_role` + `grant ... to authenticated` (L88-91 / L142-145).

`target_account` is always re-checked through `is_account_member` and is never trusted as an authorization source — it is only the lookup key. A member cannot write to another account: the membership check is on the same `target_account` used in every DML. **No write path bypasses the member check.** Good.

### PASS — `delete_custom_section` cannot touch a default section's value
Guard `p_field_key !~ '^c_[a-z0-9_]{1,40}$'` (L109) rejects every default key (`about`, `offering`, `how`, `pricing`, `policies`, `voice`, `faq`, plus `hard_rules`/`notes`) — none start with `c_`. A crafted key such as `c_about` is a *distinct* custom key: deleting it removes only a `c_about` row and the `c_about` JSONB key (L115-122), never the default `about`. `field_key` is bound as a parameter ($2 in tests; named `p_field_key` via PostgREST) and used in parameterized predicates / JSONB `-` operator — **no SQL injection.** Good.

### PASS — `GET /api/brain/sources` is member-scoped, no cross-account leak
`route.ts` calls `appSession()` and returns 401 on throw (L14-20). Every query is `.eq('account_id', accountId)` (L31) AND the `sources` table has RLS `sources_member_read ... using (private.is_account_member(account_id))` (Foundation migration L81) — defence in depth. `sort` is whitelisted (`SORT_WHITELIST`, sourcesQuery L37/L96), `group` validated against `VALID_GROUPS` (L85/L91), `dir` coerced to asc/desc, `limit` clamped 1..100, `offset` clamped ≥0. `q` is passed as a value to PostgREST `.ilike()` (parameterized) — **no injection.** Good.

### Minor 1 — `q` ilike pattern metacharacters not escaped (and no length clamp)
`route.ts:35` — `query.ilike('title', '%${params.q}%')`. `params.q` is only trimmed (`sourcesQuery.ts:88`); `%` and `_` inside a user-supplied `q` are treated as LIKE wildcards, so a search for `a_b` matches `axb`, and a single `%` matches everything. Not injection (PostgREST parameterizes the value) and not cross-account (RLS holds), but it is a correctness/abuse-surface nit. There is also no max length on `q`, so a multi-KB `q` produces a wide table scan. **Fix:** escape `\ % _` in `q` before interpolating, and clamp `q` to e.g. 200 chars in `parseSourcesParams`.

### PASS — 40-section cap is race-safe
The advisory lock (L47) is taken BEFORE the `count(*)` (L50-58) and the insert (L61) in the same transaction, so two concurrent adds serialize and the cap cannot be exceeded by a count/insert race. The cap counts `is_custom and not is_hidden`, and only enforces on a genuinely-new key — re-upsert of an existing custom key skips the cap (correct). Hidden customs do not count toward the cap (a deliberate design choice; means a user could accumulate >40 hidden custom rows, but that is bounded by their own action and harmless).

---

## Lens 2 — Claims-auditor

### PASS — RPC arg NAMES match the migration signatures exactly
`actions.ts` `saveSectionMeta` sends `{ target_account, p_field_key, p_label, p_sort_order, p_is_custom, p_is_hidden }` (L112-119) — exactly the SQL params (migration L24-29). `deleteSection` sends `{ target_account, p_field_key }` (L146-149) — exactly matches (L97-98). PostgREST resolves by name; **no silent no-write mismatch.** (This class of bug bit the codebase before; it is clean here.)

### PASS — "fresh account renders neutral defaults" is TRUE in the real render path
`page.tsx` loads `metaRows` account-scoped and degrades to `[]` on pre-migration / empty / error (L88-95, L152-155). `MemoryClient` always calls `buildSectionRegistry(metaRows ?? [])` (L101), which with `[]` emits the 7 neutral defaults from `DEFAULT_SECTIONS`. No photographer copy survives in any production string — a repo grep finds photographer terms only in test fixtures/assertions, never in `memory-sections.ts`, `fields.ts`, or rendered components.

### PASS — `hard_rules`/`notes` are NEVER emitted as a section
`registry.ts` `EXCLUDED_KEYS` (L57) and `fields.ts` `SECTION_EXCLUDED` (L126) both exclude `hard_rules`+`notes` from the section list and from `toRpcPayload.sections` (L153-154). They remain separate RPC params throughout. Verified.

### Minor 2 — stale "8 neutral defaults" comments contradict the code (7)
`MemoryClient.tsx:98-99` and `GroveMemoryTab.tsx` comments disagree: one says "8 neutral default sections", another says "7 neutral default sections". The truth is 7 sections (`DEFAULT_SECTIONS` has 7 entries); the spec's "eight universal fields" table counts `hard_rules`, which is explicitly NOT a section. Code is correct and self-consistent; only the inline comment is wrong. **Fix:** change the `MemoryClient.tsx:98` comment to "7 neutral default sections." Cosmetic, no behavior impact.

### Note — tests are substantive, not tautological
`section-meta.rpc.test.ts` / `section-meta-delete.rpc.test.ts` run against a real DB harness, assert a real cross-account rejection (non-member → raise), the 40-cap raise, the regex raise, and version-bump/history-append. Not self-referential.

---

## Lens 3 — Logic-skeptic

### Important 1 — slug collision silently overwrites a prior custom section
`actions.ts:109` slugs new custom labels via `labelToFieldKey(label)` with **no uniqueness check**, and `upsert_section_meta` uses `on conflict (account_id, field_key) do update` (migration L63-66). Two labels that slug to the same key — e.g. `"My Stuff"` and `"my-stuff!"` both → `c_my_stuff`, or any two labels differing only in punctuation/case — will:
1. pass the 40-cap (the key already exists, so the cap branch L50-53 is skipped),
2. overwrite the first row's `label`/`sort_order`/`is_hidden` with the second's,
3. leave the first section's stored value (in `grove_memory.sections['c_my_stuff']`, written separately by `save_grove_memory`) now displayed under the SECOND section's label.

Net: the user loses one section's identity and the two sections' content merges under one header. Blast radius is the owner's own account (self-inflicted, recoverable by editing), so it is not Critical, but it is a real data-integrity defect that will surface in normal use. **Fix:** in `saveSectionMeta`, when creating a NEW custom section, detect an existing `field_meta` row for the slugged key and disambiguate (`c_my_stuff_2`) or reject with an inline "a section with a similar name already exists" error. Cheapest server-side fix: have `upsert_section_meta` raise on conflict when `p_is_custom` and the row already exists with a *different* label, rather than silently updating.

### PASS — legacy `facts`→`about` forward-map causes no data loss
`forwardMapLegacy` (registry.ts:191-203) only copies `facts`→`about` when `about` is empty/blank; when BOTH have values it returns `{...values}` unchanged (the original `about` wins, `facts` retained). No overwrite, no loss.

### PASS — `buildSectionRegistry([])` returns exactly the 7 neutral defaults
With empty meta, the custom loop (L121-136) is skipped, `EXCLUDED_KEYS` drops nothing extra (defaults contain no `hard_rules`/`notes`), and all 7 defaults emit with their `DEFAULT_SORT_ORDERS` (100..700). Verified.

### PASS — hide-a-default then re-add preserves the value
Hiding a default writes `is_hidden=true` via `upsert_section_meta` (does not touch `grove_memory.sections`). The value persists in JSONB and is re-emitted by `toRpcPayload` (which always iterates all `DEFAULT_SECTION_KEYS`, fields.ts:144). Un-hiding (re-add) flips `is_hidden=false`; the value reappears. Custom delete (`delete_custom_section`) intentionally drops the value (`sections - key`), which is the correct semantic for a user-created section. Value-survival semantics match the spec.

### Minor 3 — reorder is a no-op when two siblings share a sort_order
`sectionControls.reducer.ts` MOVE_UP/MOVE_DOWN (L177-247) swap the two siblings' `sortOrder` values. If the pair has EQUAL `sortOrder` (possible when a custom row defaulted to 1000 collides with another, or after several adds/hides), the swap is a no-op and the stable re-sort leaves order unchanged — the move button appears dead. Defaults get distinct 100-spaced orders so they never collide; the risk is confined to custom rows that landed on the same value. **Fix:** when swapping, if `prev.sortOrder === curr.sortOrder`, assign deterministically distinct values (e.g. `curr := prev.sortOrder - 1`) instead of swapping equals. Low severity — cosmetic, recoverable.

### PASS — sourcesLibrary reducer SET_SORT/SET_FILTER/UPLOAD_DONE
`SET_SORT` toggles dir on same column else resets to desc (L136-144) — correct. `SET_FILTER` uses `!== undefined` so a `null` clears a filter while an omitted key preserves the other (L129-134) — correct. `UPLOAD_DONE` prepends with `extractionState:'pending'` (L149-155) — correct. `derivedItems` group filter `item.mimeGroup === s.group` handles `'other'` correctly CLIENT-side (L78-80).

### Minor 4 — `groupToMimeFilter('other')` route no-op (latent; flagged by Task 8 implementer)
`sourcesQuery.ts:163-165` returns `[]` for `group='other'`, and `route.ts:41` only applies a filter when `filters.length > 0`. So a request with `?group=other` applies NO mime filter and returns ALL rows instead of only the ungrouped ones. **Currently dormant:** `SourcesLibrary.tsx` fetches `GET /api/brain/sources` with no params and does all filtering client-side via `derivedItems` (where 'other' works), so the shipped UI never triggers the route bug. It remains a real defect for any future caller or direct API consumer. **Fix:** in the route, build an `not.or(...)` exclusion for the known mime patterns when `group==='other'`, or document the param as client-only.

---

## Lens 4 — Cost / correctness

### PASS — no unbounded query
`GET /api/brain/sources` clamps `limit` to 1..100 (default 50) and uses `.range(offset, offset+limit-1)` (route L57-58). No N+1: `page.tsx` issues a small fixed number of queries (grove_memory, optional grove_state, field_meta, field_evidence-with-join) — the evidence query uses a single `sources!inner` join, not per-row fetches.

### Minor (folded into Minor 4 family) — client filters over a server-capped result set
`SourcesLibrary.tsx` fetches `GET /api/brain/sources` with NO `limit`/`offset`/filter params, so the server returns at most the default 50 rows (captured_at desc), and ALL search/filter/sort then runs client-side over that truncated 50. An account with >50 sources will "filter" only the newest 50 and silently miss older matches, with no pagination control in the UI. Not a security issue and acceptable for an early library, but worth tracking: either raise the client `limit` to 100 explicitly, push filters to the server, or add pagination. (Counted within the Minor tally as part of the sources-library correctness gaps.)

---

## Must-fix list (Critical/Important)

1. **(Important) Slug collision overwrite** — two custom-section labels that slug to the same `c_*` key silently overwrite via `on conflict do update`, merging content under one header and bypassing the 40-cap. Add a uniqueness/disambiguation check in `saveSectionMeta` (or raise-on-different-label in `upsert_section_meta`). `apps/web/app/app/memory/actions.ts:103-110`, migration `20260623130000_*.sql:61-66`.

## Should-fix (Minor)
2. Escape ilike metacharacters + clamp length on `q` (`route.ts:35`, `sourcesQuery.ts:88`).
3. Fix stale "8 neutral defaults" comment (`MemoryClient.tsx:98`).
4. Make reorder swap deterministic when sort_orders are equal (`sectionControls.reducer.ts:177-247`).
5. Fix/disclaim `group='other'` route no-op and raise/paginate the client fetch limit (`sourcesQuery.ts:163`, `route.ts:39-48`, `SourcesLibrary.tsx:124`).
