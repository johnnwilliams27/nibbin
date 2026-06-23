# Task 4 (P2) Implementation Report: DocUploadCard

## Status
DONE — 38 tests pass, typecheck clean, committed.

## Files Created / Modified

| Action   | File                                                              |
|----------|-------------------------------------------------------------------|
| Created  | `apps/web/components/brain/DocUploadCard.tsx`                     |
| Created  | `apps/web/components/brain/DocUploadCard.module.css`              |
| Created  | `apps/web/components/brain/DocUploadCard.test.tsx`                |
| Modified | `apps/web/app/app/memory/page.tsx` (1 import + 1 JSX element)    |

## Mount Point for P1 Integration

Current mount in `apps/web/app/app/memory/page.tsx`:

```tsx
// Below the <form>…</form> closing tag, before </AppShell>
<DocUploadCard />
```

Import added at top of page.tsx:
```ts
import { DocUploadCard } from '../../../components/brain/DocUploadCard';
```

**P1 Sources tab integration:** remove the `<DocUploadCard />` from page.tsx and place it in P1's Sources tab empty-state or sources panel. The component is fully self-contained — no other changes needed. No props required for normal use.

## Architecture

### State machine
Pure reducer `docUploadReducer` (exported) drives all state transitions:
`idle | dragging | uploading | processing | done | error | timedout`

### `_testState` prop
The component accepts an optional `_testState?: Partial<DocUploadState>` prop that overrides internal state. This enables `renderToStaticMarkup` tests to produce deterministic markup for each phase without running effects or fetch calls. It is not used in production (no props required).

### Exports (for unit tests)
- `DocUploadCard` — the component
- `docUploadReducer` — pure state reducer
- `validateFile` — client-side type + size validation
- `DocUploadState`, `DocUploadAction` — types

### Client-side validation
`validateFile` enforces (before any fetch):
- `.doc` (application/msword) → `doc_not_supported` with "save as .docx" nudge
- Unsupported MIME → `unsupported_type` with accepted-types list
- `file.size > 20 MB` → `file_too_large` with actual + limit MB counts

### Upload + polling flow
1. `POST /api/brain/documents/upload` with FormData → 202 + `{sourceId}`
2. `setInterval(2000ms)` polls `GET /api/brain/sources/{sourceId}/status`
3. Stops after `done`/`error` or 45 polls (90 seconds → `timedout` state)

### Done state
Shows "Found N things to check — review below." with a link to:
`/app/memory#proposals?source={sourceId}`

### §14.5 empty nudge copy
Rendered in idle/dragging states:
> "Don't want to type it all out? Drop in a doc — Nibbin will read it and suggest what to remember."

## Test Coverage (38 tests)

| Suite                                     | Count |
|-------------------------------------------|-------|
| Static structure (SSR — idle)             | 5     |
| Static structure (SSR — progress states)  | 7     |
| validateFile                              | 12    |
| docUploadReducer                          | 12    |
| Done state review link                    | 2     |

Test strategy: `renderToStaticMarkup` for SSR structure; pure function calls for reducer + validateFile. No jsdom, no happy-dom.

## Decisions

- **No new UI primitives.** Uses existing tokens (`var(--moss)`, `var(--r-card)`, etc.) and CSS modules. Spinner is a CSS animation to avoid importing the Spinner component in a client boundary.
- **`_testState` rather than full `storybook`-style props.** Keeps the production API zero-props while making all phases testable via SSR.
- **Deep link to `#proposals` anchor.** The F2 review surface is expected at `/app/memory#proposals`; the `?source=` query parameter allows the review panel to filter by source_id when that UI is built.
- **`void handleFile(file)` in event handlers.** Async event handlers are fire-and-forget; lint would flag un-handled promises without `void`.

## Concerns

1. **`.doc` via drag-and-drop MIME sniffing.** On some browsers, dragged `.doc` files may present as `application/octet-stream` rather than `application/msword`. The `validateFile` function checks `file.type` — if the browser doesn't fill it, the file will pass type validation and hit the server's `.doc` check (422 `doc_not_supported`). The server error message flows back to the `UPLOAD_ERROR` state. Not a blocking issue, but worth noting for cross-browser QA.

2. **`timedout` state and fire-and-forget.** The 90s poll timeout shows "check back in a moment" — this is the correct UX per the plan's risk register. If the Vercel function is killed before `extractDocument` finishes, the job row stays `pending` and the poll times out gracefully.

3. **F2 review link anchor.** `/app/memory#proposals` is a placeholder anchor. The P1 redesign or the F2 review UI build should define the canonical URL (could become `/app/proposals` or a Sources tab panel). Update `DocUploadCard.tsx` line with `href={\`/app/memory#proposals...`}` at that point.
