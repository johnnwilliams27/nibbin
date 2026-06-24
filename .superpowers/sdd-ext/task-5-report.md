# Task 5 Report — Section-meta server actions

## Status: COMPLETE

## Files modified
- `apps/web/app/app/memory/registry.ts` — added `labelToFieldKey(label): string` slug helper
- `apps/web/app/app/memory/actions.ts` — added `saveSectionMeta(formData)` and `deleteSection(formData)` server actions
- `apps/web/app/app/memory/actions.test.ts` — extended with 18 new tests (Task 5 coverage)

## Implementation

### `labelToFieldKey` (registry.ts)
Slug algorithm: lowercase → replace non-alphanumeric with `_` → collapse consecutive `_` → trim leading/trailing `_` → clamp body to 40 chars → prefix `c_`. Fallback body `section` when no alphanumeric chars remain. Always matches `^c_[a-z0-9_]{1,40}$`.

### `saveSectionMeta` (actions.ts)
Calls `supabase.rpc('upsert_section_meta', { target_account, p_field_key, p_label, p_sort_order, p_is_custom, p_is_hidden })` with EXACT arg keys. For new custom sections (no `field_key` in FormData), `p_field_key` is server-slugged from the label via `labelToFieldKey`. For existing keys, passes through unchanged. Returns `{ok:true}` or `{ok:false,error}`, no redirect.

### `deleteSection` (actions.ts)
Calls `supabase.rpc('delete_custom_section', { target_account, p_field_key })` with EXACT arg keys. Returns `{ok:true}` or `{ok:false,error}`, no redirect.

## Tests: 33 passed (0 failed)
- Bidirectional arg-key assertion for `upsert_section_meta` (6 keys sorted)
- Bidirectional arg-key assertion for `delete_custom_section` (2 keys sorted)
- Slug correctness: "Brand Guidelines!" → `c_brand_guidelines`; all-symbols fallback → `c_section`; collapse repeats; clamp to 40; numeric-only labels
- Inline return shapes `{ok:true}` / `{ok:false,error}` on success and RPC error for both actions
- No redirect on per-field saves (§5.3)

## Typecheck
`npm run typecheck` clean for Task 5 files. Pre-existing errors in `.next/types`, `@vercel/analytics/next`, `@sparticuz/chromium` are unrelated to this task.

## Concerns
None. All invariants from the plan satisfied.
