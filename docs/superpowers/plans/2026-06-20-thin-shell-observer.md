# Thin-Shell Observer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop app's UI 100% the web app — a thin native shell (capture daemon + OS glue + an origin-locked bridge) renders `nibbin.com/app`; the native Field Study UI is deleted and rebuilt as shell-gated web routes.

**Architecture:** Three layers — (1) the web app in the desktop webview (one nav); (2) `observerd`, the local capture daemon (unchanged); (3) native glue + a Tauri IPC "bridge" exposed *only* to the bundled `nibbin.com` origin. The Field Study surfaces become web routes that call the bridge when running in the shell, and show a download gate in a plain browser.

**Tech Stack:** Tauri 2 (Rust shell + WebviewBuilder External), Next 15 App Router (web routes), the existing `apps/desktop/src/ui/bridge.ts` invoke contract, `observerd` over local IPC.

## Global Constraints (privacy invariants — verbatim, every task)

- Capture is **local-only until a user-approved packet upload** (C7). The bridge adds NO new egress path; `reviewData`/`fieldNotes` return only already-redacted/derived data.
- 14-day wall-clock stop + anti-rollback (C2), secure-fields-by-construction (C4), pause near-instant — all remain **daemon-side**. The bridge is display+control, never the authority.
- The bridge IPC capability is granted **only** to the `nibbin.com` origin; webview navigation stays allowlisted (the existing `on_navigation` lock in `lib.rs`). Non-allowlisted origins get no bridge.
- Sensitive paths touched (`apps/desktop/src-tauri/`, `apps/web/app/api/` if any) → the 4-reviewer adversarial gate is required before merge; commit the report to `docs/gates/`.
- One-go cutover (owner + friends only today); land via feature branch → PR → CI; ship desktop `0.2.3` after merge.

## File Structure

- `apps/desktop/src-tauri/app/capabilities/default.json` — add the scoped `remote` IPC grant for `nibbin.com`.
- `apps/desktop/src-tauri/app/src/lib.rs` — register the gap bridge commands; main window loads the web app; keep tray/hotkey/permissions/spawn.
- `apps/web/lib/desktop/bridge.ts` (NEW) — typed web-side wrapper over the Tauri invoke surface + `isShell()` probe.
- `apps/web/app/app/study/{page,review/page,notes/page,preferences/page}.tsx` (NEW) — the Field Study routes.
- `apps/web/components/study/*` (NEW) — shared study components (status card, review list, etc.).
- DELETE: `apps/desktop/src/ui/views/{field-study,consent,study,field-study-state}.ts`, the sub-tab nav + Grove/Field-Study tab logic in `apps/desktop/src/ui/main.ts`, the native top tab bar.

---

### Task 1: SPIKE — prove scoped remote-origin IPC from the embedded nibbin.com webview

**This task de-risks the whole plan. Do it first; its outcome sets the exact config used everywhere below.**

**Files:** `apps/desktop/src-tauri/app/capabilities/default.json`, `apps/desktop/src-tauri/app/src/lib.rs`

**Success criteria (the "test"):**
1. The embedded Grove webview (External `nibbin.com`) can successfully `invoke('study_status')` and receive the real daemon response.
2. A webview navigated to any non-allowlisted origin canNOT invoke it (denied).

- [ ] **Step 1:** Read `capabilities/default.json` and the Tauri 2 docs for granting IPC to a remote URL (the capability `remote: { urls: [...] }` field / `app.security` remote-domain access). Add a capability scoping the bridge commands to `https://nibbin.com` only.
- [ ] **Step 2:** Temporarily add a tiny test call in the embedded web app (or via devtools console in the Grove webview) that invokes `study_status`; confirm it returns the daemon snapshot.
- [ ] **Step 3:** Confirm the `on_navigation` lock (lib.rs ~91) still blocks navigation away from `nibbin.com`, and that a non-allowlisted origin can't reach the command.
- [ ] **Step 4:** Document the working capability config in the plan's notes + commit: `feat(desktop): scoped remote-origin IPC for the bundled nibbin.com webview`.
- [ ] **BLOCKED handling:** if Tauri 2 cannot scope IPC to a remote origin safely, STOP and escalate — the architecture choice (Option A) depends on this. Fallback would be a localhost bridge server, which is a different design.

### Task 2: Web-side bridge wrapper + `isShell()` probe

**Files:** Create `apps/web/lib/desktop/bridge.ts`; Test `apps/web/lib/desktop/bridge.test.ts`

**Interfaces — Produces:** `isShell(): boolean`, and typed async `desktopBridge` with `studyStatus()`, `reviewData()`, `fieldNotes()`, `exclusions()`, `captureHealth()`, `startStudy(opts)`, `pause()`, `resume()`, `stopEarly()`, `addExclusion(s)`, `removeExclusion(s)`, `deleteEverything()`, `buildPacket()`, `uploadPacket(packet)`, `onStudyStateChange(cb)`, `onCaptureHealth(cb)`. Mirrors the command names from the native `apps/desktop/src/ui/bridge.ts`.

- [ ] **Step 1:** Write `bridge.test.ts`: `isShell()` returns false when `window.__TAURI__` is absent; returns true when present; `studyStatus()` calls the underlying invoke with `'study_status'` (mock the invoke).
- [ ] **Step 2:** Run it — fails (module not created).
- [ ] **Step 3:** Implement `bridge.ts`: detect Tauri (`'__TAURI__' in window` / `'__TAURI_INTERNALS__'`), wrap `invoke` into the typed surface, no-op/`null` when not in shell.
- [ ] **Step 4:** Run the test — passes.
- [ ] **Step 5:** `npm run lint && npm run typecheck`; commit: `feat(web): desktop bridge wrapper + isShell probe`.

### Task 3: Native handlers for the gap commands

**Files:** `apps/desktop/src-tauri/app/src/lib.rs` (extend `invoke_handler` ~166), reusing logic from the existing native bridge + `apps/desktop/src/ui/sync-study.ts` (packet build/upload) and the daemon control path.

**Interfaces — Consumes:** the daemon control IPC the existing `send_control`/`study_status`/`review_events` commands already use. **Produces:** Tauri commands `exclusions`, `add_exclusion`, `remove_exclusion`, `field_notes`, `delete_everything`, `build_packet`, `upload_packet` (names the web bridge in Task 2 invokes).

- [ ] **Step 1:** For each gap command, add a Rust `#[tauri::command]` that calls the corresponding daemon control/query (mirror the existing `send_control`/`review_events` handlers). `delete_everything` maps to the daemon's `delete_everything` control; `field_notes`/`exclusions` map to daemon queries.
- [ ] **Step 2:** Register them in `generate_handler![...]` (lib.rs ~166).
- [ ] **Step 3:** `cargo check -p nibbin-observer-app` (the new CI app-check job mirrors this) — compiles clean.
- [ ] **Step 4:** Commit: `feat(desktop): bridge commands for exclusions, field notes, delete-all, packet`.

### Task 4: `/app/study` — live/in-progress route

**Files:** Create `apps/web/app/app/study/page.tsx`, `apps/web/components/study/StudyStatusCard.tsx` + module CSS.

- [ ] **Step 1:** Build the in-progress view from `desktopBridge.studyStatus()` + `onStudyStateChange` — countdown, "Watching" status (placed cleanly, per web design system), capture-health ("taking a breather") state, Pause/Resume/Stop controls. **Event-driven refresh, not a per-second re-render** (avoids the old shutter).
- [ ] **Step 2:** When `!isShell()`, render a download gate (reuse/ð the "get the desktop app" content).
- [ ] **Step 3:** Visual check in the shell (study running) + in a browser (gate).
- [ ] **Step 4:** `npm run lint && npm run typecheck && npm run build`; commit: `feat(study): in-progress route`.

### Task 5: `/app/study/review` — what the study kept

**Files:** Create `apps/web/app/app/study/review/page.tsx`, `apps/web/components/study/ReviewList.tsx`.

- [ ] **Step 1:** Render `desktopBridge.reviewData()` (already-redacted) grouped by app/source; per-item + per-source delete via `removeExclusion`/delete; the "never record this again" exclusion input as a proper input *unit* (per web-polish principles). No "1 moments" pills — inline counts.
- [ ] **Step 2:** `!isShell()` → download gate.
- [ ] **Step 3:** Visual check; `npm run lint && npm run typecheck && npm run build`; commit: `feat(study): review route`.

### Task 6: `/app/study/notes` — today's field notes

**Files:** Create `apps/web/app/app/study/notes/page.tsx`.

- [ ] **Step 1:** Render `desktopBridge.fieldNotes()`; designed `EmptyState` (from the web-polish plan, or a local one if that plan hasn't landed) when empty — not a bare card.
- [ ] **Step 2:** `!isShell()` → download gate.
- [ ] **Step 3:** Visual check; lint/typecheck/build; commit: `feat(study): field notes route`.

### Task 7: `/app/study/preferences` — exclusions, depth, delete-everything

**Files:** Create `apps/web/app/app/study/preferences/page.tsx`.

- [ ] **Step 1:** Exclusions list (add/remove), capture depth (Lite/Detailed) via the daemon, and a guarded `deleteEverything()` confirm. NO "go to nibbin.com for account settings" card — link to the in-app `/app/settings`.
- [ ] **Step 2:** `!isShell()` → download gate.
- [ ] **Step 3:** Visual check; lint/typecheck/build; commit: `feat(study): preferences route`.

### Task 8: Grove-home card swap (download ↔ live status)

**Files:** Modify the Grove-home card that currently does `HideInDesktop` for "get the desktop app" (in `apps/web/app/app/page.tsx` / the desktop-app card component).

- [ ] **Step 1:** When `isShell()`, render a compact live "Field study" status card (countdown / Watching / quick pause) linking to `/app/study`; in a browser, keep the existing "Get the desktop app" card.
- [ ] **Step 2:** Visual check (shell vs browser); lint/typecheck/build; commit: `feat(study): grove-home card swaps to live observer status in the shell`.

### Task 9: Cutover — delete native UI, one web nav, offline fallback

**Files:** `apps/desktop/src-tauri/app/src/lib.rs` + `apps/desktop/src/ui/*`; DELETE the native Field Study UI.

- [ ] **Step 1:** Point the main window at the web app (`/app`) instead of the native two-tab shell — the embedded web app *is* the UI; keep the existing navigation lock + session handoff.
- [ ] **Step 2:** DELETE `apps/desktop/src/ui/views/{field-study,consent,study,field-study-state}.ts`, the sub-tab nav, and the Grove/Field-Study tab logic in `main.ts`. Keep `bridge.ts` only if still referenced by remaining native glue; otherwise remove.
- [ ] **Step 3:** Add a minimal **native offline fallback**: if the web app can't load (`on_navigation`/load error), show a tiny native screen — "Can't reach Nibbin — capture is still running. Retry." — so the daemon isn't orphaned.
- [ ] **Step 4:** `cargo check -p nibbin-observer-app` + `npm run lint && npm run build`; commit: `feat(desktop): cutover to one web nav; delete native Field Study UI; offline fallback`.

### Task 10: Gate, release 0.2.3, on-device verify

- [ ] **Step 1:** Run the 4-reviewer adversarial gate (sensitive: `src-tauri/`, bridge); commit `docs/gates/2026-06-20-thin-shell-observer.md`. Fix any P1/P2.
- [ ] **Step 2:** PR → main; the new "Desktop app crate (cargo check)" CI job must pass (proves the shell compiles). Merge.
- [ ] **Step 3:** Bump `tauri.conf.json` → `0.2.3`; tag `desktop-v0.2.3`; confirm the signed build publishes.
- [ ] **Step 4:** On-device (Windows): study setup → in-progress → review → delete all run entirely in the web UI inside the shell; capture still works; offline fallback shows when nibbin.com is unreachable.

---

## Self-Review

- **Spec coverage:** architecture/3-layers → Tasks 1,3,9; bridge + security → Tasks 1,2,3; Field Study routes → Tasks 4–7; card swap → Task 8; cutover + deletions → Task 9; offline fallback (spec open question) → Task 9; release → Task 10. ✓
- **Risk-first:** the remote-IPC unknown is Task 1 with explicit BLOCKED escalation. ✓
- **Placeholders:** Task 1 is a genuine spike (investigate + prove) — its config output feeds later tasks; not a hand-wave. No other deferrals.
- **Consistency:** `desktopBridge`/`isShell()` defined in Task 2, consumed in Tasks 4–8; native commands defined in Task 3 match the bridge wrapper names in Task 2.
- **Privacy:** no new egress (Constraint block); bridge origin-locked (Task 1); daemon stays enforcer.
