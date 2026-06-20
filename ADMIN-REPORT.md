# Admin Layout Responsive Fix — Report

## Status: DONE

## Commits

| Hash | Description |
|------|-------------|
| `9b91e5bb` | `admin: responsive topbar + soften mono labels to sans` |
| `9c1a94bf` | `admin: wrap all tables in tableWrap for horizontal scroll + nowrap cells` |

---

## Files Changed

### `apps/admin/app/admin.module.css`
All three concerns handled here:

**1. Responsive topbar**
- `.topbar`: added `flex-wrap: wrap; gap: 12px 16px;`
- `.nav`: added `flex-wrap: wrap;`
- `.who`: added `flex-wrap: wrap; min-width: 0; overflow-wrap: anywhere;`
- `@media (max-width: 720px)`: `.topbar { flex-direction: column; align-items: flex-start; }` — stacks nav + who-block on narrow screens

Breakpoint used: **720px**

**2. Table horizontal scroll**
- Added `.tableWrap { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }`
- `.table th`: added `white-space: nowrap`
- `.table td`: added `white-space: nowrap`

**3. Font softening**
- `.brand`: `var(--mono)` → `var(--sans)`, `letter-spacing: 0.12em` → `0.04em`
- `.table th`: `var(--mono)` → `var(--sans)`, `letter-spacing: 0.1em` → `0.04em`
- `.statLabel`: `var(--mono)` → `var(--sans)`, `letter-spacing: 0.12em` → `0.04em`
- `.mono` class: **unchanged** — UUIDs, timestamps, spend values stay monospace

`text-transform: uppercase` retained on `.table th` and `.statLabel` (column/stat labels). Also retained on `.brand`.

---

### Tables that received `tableWrap`

| Page | Tables wrapped |
|------|---------------|
| `apps/admin/app/accounts/page.tsx` | Accounts list (Name/Tier/Status/Members/Created/30d spend) |
| `apps/admin/app/accounts/[id]/page.tsx` | Per-model breakdown; Recent credit ledger; Recent audit log |
| `apps/admin/app/analytics/page.tsx` | Daily trend (30d); Desktop downloads by release |
| `apps/admin/app/scoreboard/page.tsx` | Per-task model perf (dynamically mapped); Capability scoreboard; Shop template adoption |
| `apps/admin/app/waitlist/page.tsx` | Waitlist list |

Total: **9 table instances** wrapped across 5 files.

---

## Prose-cell exceptions

- **Credit ledger "Reason" column** (`accounts/[id]/page.tsx`): inline `style={{ whiteSpace: 'normal' }}` applied — reason text is user-supplied prose that should wrap within the scroll container, not force the table wider.
- **Audit log "Action" column**: left as-is (short action strings, effectively nowrap in practice).
- **Waitlist "Invite" column**: contains a form/button, not prose — nowrap is fine; the scroll container handles width.

The Accounts "Name" cell two-line stack (`<a>name</a><br/><span class=mono>uuid</span>`) is preserved exactly. The UUID stays full-width on one line within the scroll container; the `<br/>` keeps the two-line layout staff expect.

---

## Verification

```
npm run lint        → clean (no output)
npm run typecheck   → clean (no output, 0 errors in changed files)
```

Pre-existing `@nibbin/*` junction noise was not triggered (admin typecheck runs standalone, doesn't resolve workspace packages that way).

`next build` not run locally (known junction issue in worktrees — pre-existing, not introduced by this change).

---

## Concerns / Notes

None. All changes are pure layout CSS and minimal JSX wrapping. No logic, queries, auth, or data paths were touched. No new dependencies.
