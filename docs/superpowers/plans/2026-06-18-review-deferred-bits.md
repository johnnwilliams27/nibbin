# Review-Deferred Bits (capture_blocked surfacing + per-segment redaction) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps. Two small, independent, **gate-free** desktop-frontend bits deferred from the Agent Synthesis review.

**Goal:** (a) Surface the daemon's `capture_blocked` status in the desktop UI so a suspended capture is visible (not silent). (b) Give the review-before-upload screen **per-segment** granularity — let the user drop individual recurring **sequences** (and url-templates) within a workflow, not just remove the whole workflow (Trust & Controls §5.2).

**Why gate-free:** both are `apps/desktop/src/` (frontend TS) + `sync-study.ts`. The daemon already serializes `capture_blocked` (`observerd/src/lib.rs:498`) and `study_status` returns the full status JSON uncurated (`src-tauri/app/src/commands.rs:68` → `read_status`), so **no Rust/`src-tauri` change is needed**. The packet's `PacketWorkflow` already carries `sequences?`/`urlTemplates?` (`@nibbin/redaction` `segment.ts`), so the segment data already exists. No migration, no sensitive path, no adversarial gate.

## File structure
- **Modify** `apps/desktop/src/ui/bridge.ts` — add `capture_blocked` to `StudyStatus` + the inert fallback.
- **Modify** `apps/desktop/src/ui/views/field-study.ts` — render a calm banner when `capture_blocked` is set.
- **Modify** `apps/desktop/src/ui/sync-study.ts` — extend `filterPacket` to drop removed sequences/url-templates per workflow.
- **Modify** `apps/desktop/src/ui/views/packet-review.ts` — per-workflow expansion with per-sequence/per-url remove toggles.

---

### Task 1 (bit a): surface `capture_blocked`

- [ ] **Step 1 — `bridge.ts`** add the field to `StudyStatus`:
```ts
export interface StudyStatus {
  state: string;
  remaining_ms: number | null;
  paused: boolean | null;
  pipeline_halted: boolean | null;
  /** Set by the daemon (observerd) when capture is suspended for a surfaced
   *  reason — e.g. an exclusion failed to persist. null = capture healthy. */
  capture_blocked: string | null;
  study: unknown;
}
```
And in the `studyStatus()` inert fallback (the object returned when there's no Tauri shell, ~line 47-52), add `capture_blocked: null,`.

- [ ] **Step 2 — `field-study.ts`** read `field-study.ts` first; in `stateView` (≈line 131), when `status.capture_blocked` is a non-empty string, render a calm warning banner at the top of the view — NOT coral/destructive; use the existing warning/notice styling (check the css for a `.notice`/`.warn`/`.muted` class; if none, a `.card` with clear copy). Copy: heading "Capture is paused" + body `${status.capture_blocked}` + a line "Capture resumes once this is resolved." Place it above the normal state content so it's seen on every render while blocked. Mirror the existing `paused`/`pipeline_halted` surfacing if there is one (grep for how `pipeline_halted`/`paused` render — match that pattern).

- [ ] **Step 3** — typecheck the desktop frontend: `cd /c/Nibbin && npx tsc --noEmit -p apps/desktop` (or the desktop tsconfig the repo uses — confirm the path; if `apps/desktop/tsconfig.json` exists use `-p apps/desktop`). Exit 0. Commit: `feat(desktop): surface capture_blocked so a suspended capture isn't silent`.

---

### Task 2 (bit b): per-segment review granularity

- [ ] **Step 1 — `sync-study.ts`** extend `filterPacket` to a richer removal model. Replace it with:
```ts
export interface ReviewRemovals {
  workflows: Set<string>;            // whole-workflow keys removed
  sequences: Set<string>;            // `${wfKey}#${seqIndex}` removed
  urls: Set<string>;                 // `${wfKey}#${urlTemplate}` removed
}

/** Drop removed workflows entirely; for kept workflows, strip the individual
 *  sequences / url-templates the user removed (per-segment granularity, §5.2). */
export function filterPacket(packet: DiagnosisPacket, removed: ReviewRemovals): DiagnosisPacket {
  const workflows = packet.workflows
    .filter((w) => !removed.workflows.has(w.key))
    .map((w) => {
      const sequences = (w.sequences ?? []).filter((_s, i) => !removed.sequences.has(`${w.key}#${i}`));
      const urlTemplates = (w.urlTemplates ?? []).filter((u) => !removed.urls.has(`${w.key}#${u}`));
      return {
        ...w,
        ...(w.sequences ? { sequences } : {}),
        ...(w.urlTemplates ? { urlTemplates } : {}),
      };
    });
  return { ...packet, workflows };
}
```
(Confirm `DiagnosisPacket`/`PacketWorkflow` spread typechecks — `sequences`/`urlTemplates` are optional. Keep the back-compat: a workflow with no sequences/urls is unchanged.)

- [ ] **Step 2 — `packet-review.ts`** rewrite the render so each workflow card can expand to show its sequences + url-templates with per-item Remove, alongside the existing whole-workflow Remove. Use a single `ReviewRemovals` state. Sketch:
```ts
const removed: ReviewRemovals = { workflows: new Set(), sequences: new Set(), urls: new Set() };
```
For each workflow `w`:
- the existing whole-workflow Remove/keep toggle (adds/removes `w.key` in `removed.workflows`);
- when the workflow is NOT removed, list its `w.sequences` (label each by `seq.steps.join(' → ')` + `×${seq.count}`) each with a small Remove toggle keyed `${w.key}#${i}` in `removed.sequences`; and its `w.urlTemplates` each with a Remove toggle keyed `${w.key}#${u}` in `removed.urls`. Removed sub-items render struck/greyed with a "keep" affordance.
- A removed workflow hides its sub-items (they're moot).
Final send: `onDecision({ action: 'send', packet: filterPacket(packet, removed) })`. Update the count line to reflect kept workflows (sub-item removals don't change the workflow count; keep the "Send to Nibbin (N)" = remaining workflows). Keep the "Delete instead" button. Keep tokens/styling consistent with the existing `.review-row`/`.card` classes; add small CSS for the sub-item list if needed (tokens only — check `observer.css`).

- [ ] **Step 3** — `cd /c/Nibbin && npx tsc --noEmit -p apps/desktop` → exit 0. If there are desktop unit tests for `filterPacket`/sync-study, update them for the new `ReviewRemovals` signature (grep `filterPacket` in tests). Commit: `feat(desktop): per-segment review — drop individual sequences/urls before upload (§5.2)`.

---

### Task 3: Verify
- [ ] `cd /c/Nibbin && npx tsc --noEmit -p apps/desktop` → exit 0.
- [ ] `cd /c/Nibbin && npx vitest run apps/desktop/` (if desktop tests exist; else note none) → green; in particular any `sync-study`/`filterPacket` test updated for `ReviewRemovals`.
- [ ] grep for other `filterPacket(` callers and confirm all pass the new `ReviewRemovals` shape (not the old `Set<string>`).
- [ ] No coral added to the capture_blocked banner; tokens-only.

## Self-review
- Gate-free (desktop frontend + sync-study only; daemon already emits `capture_blocked`; packet already carries `sequences`/`urlTemplates`). No migration, no `src-tauri`, no sensitive path.
- bit (a): a suspended capture is now visible (not silent), calm framing, no coral. bit (b): §5.2 per-segment granularity — finer control over the only artifact that leaves the device (C7), without changing the egress contract (we only ever send LESS).
- Both compile under the desktop tsconfig; `filterPacket`'s richer signature is updated at all call sites.
