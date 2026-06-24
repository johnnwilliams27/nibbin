# Task 1 Report: `group='other'` predicate fix

**Status:** DONE

## What was done

- Introduced `MIME_GROUP_MAP` as a single source of truth table in `sourcesQuery.ts` mapping each known group (`images`, `docs`, `sheets`, `slides`, `web`) to its exact MIME pattern strings. Prefix entries (`image/`) end with `/` and are expanded to `image/%` wildcard for predicate use.
- Added exported `groupToMimePredicate(group): MimePredicate` pure helper returning `{ kind: 'in' | 'notin' | 'none', patterns: string[] }`. Known groups → `kind:'in'`; `'other'` → `kind:'notin'` with ALL known-group patterns as the exclusion list; `null`/`undefined` → `kind:'none'`.
- Removed old `groupToMimeFilter` (was a pass-through for `'other'`, now superseded).
- Updated `route.ts` to import `groupToMimePredicate` and apply: `.or(orClause)` for `kind:'in'`; `.not('mime_type', 'or', notOrClause)` for `kind:'notin'`; no predicate for `kind:'none'`.

## Test summary

46 tests pass (35 pre-existing + 11 new). New tests cover: `groupToMimePredicate` for all 5 known groups + `'other'` exclusion semantics + `null`/`undefined` → none; route test asserting `group='other'` triggers `.not()` call (not a pass-through).

## Typecheck

Green except the 4 known pre-existing worktree errors (`.next/types` ×2, `@vercel/analytics` ×2, `@sparticuz/chromium` ×3 — unchanged from before this task).

## Concerns

None. The `notin` implementation uses Supabase `.not('mime_type', 'or', notOrClause)` which is the standard PostgREST negation pattern for multi-value exclusion. The `mimeToGroup` function retains its own switch logic (not yet derived from `MIME_GROUP_MAP`) to avoid changing tested behaviour, but `groupToMimePredicate` is derived from the map, ensuring consistent group↔mime definitions going forward.
