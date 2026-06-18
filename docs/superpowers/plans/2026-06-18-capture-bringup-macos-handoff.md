# macOS Capture Adapter — Handoff (execute in a Mac-connected session)

> The Windows adapter is complete + verified. macOS was deferred because it **cannot be
> compiled on Windows** (no Apple SDK/linker) and the fork's mac code was never compiled. This
> doc captures the resolved facts so a Mac session can implement `MacAxCapture` + verify on
> hardware. Branch: `feature/capture-bringup`. Mirror the Windows adapter (`crates/nibbin-capture/src/windows.rs`, the `#[cfg(feature="screenpipe")]` `mod real`) and the patterns in Tasks 2.4/2.4b/2.5.

## Key difference from Windows (do not assume parity)
The macOS tree walker returns a **flat** `Vec<AccessibilityTreeNode>`, NOT the nested
`AccessibilityNode`/`WindowTreeSnapshot` the Windows path + `map.rs` use:
- `MacosTreeWalker::walk_focused_window() -> Result<TreeWalkResult>` (tree/macos.rs:307); `TreeWalkResult::Found(TreeSnapshot)` (tree/mod.rs:498).
- `TreeSnapshot { nodes: Vec<AccessibilityTreeNode>, ... }` (tree/mod.rs:316) — FLAT list.
- `AccessibilityTreeNode` (tree/mod.rs:71) — read its actual fields (role, text/value, depth, is_password?, bounds) on the Mac before mapping.

So you need a **new mac mapping** in `map.rs` (NOT `node_to_ax`/`parts_to_snapshot`, which take the nested `AccessibilityNode`): e.g. `pub fn tree_snapshot_to_ax(app, title, nodes: &[AccessibilityTreeNode], url) -> AxSnapshot`. Two viable shapes:
- Simplest: build a synthetic window-root `AxSnapshotNode` whose `children` are the flat nodes mapped 1:1 (role/label/value/secure). `snapshot_to_raw_events` flattens to role_paths anyway, so the depth hierarchy is partly lost but per-node role/value/secure is preserved (most of the signal).
- Better: reconstruct nesting from each `AccessibilityTreeNode`'s `depth` field into a real tree, then map. Do this if depth is available + role_path fidelity matters for diagnosis.

## Secure fields (C4) — mac differs
The mac walker **skips `AXSecureTextField` entirely** (`should_skip_role`, tree/macos.rs:774) — the secure field never appears in `nodes`. This is C4-SAFE (the value is never captured) but produces NO `SecureSuppressed` breadcrumb (unlike Windows, which flags `is_password→secure`). Decision for the Mac session: accept the skip (simplest, C4-safe) OR un-skip + set `is_password=true` on the node so the mapping flags `secure` for parity + the breadcrumb. Either is C4-correct; note the choice.

## Permissions / readiness (no Screen Recording for Lite — confirmed)
- `UiRecorder::check_permissions() -> PermissionStatus { accessibility, input_monitoring }` (platform/macos.rs:191), free fns `check_input_monitoring()` (:349), `request_input_monitoring()` (:366) — already `pub`/re-exported.
- `readiness()`: `Blocked("accessibility")` if `!accessibility` (drives the permission rehearsal); Input Monitoring is only needed for input COUNTS (the AX tree works without it). The AX tree walk does NOT require Screen Recording — Lite stays Screen-Recording-free. ✓

## App/window/pid
- `get_focused_app_info() -> Option<(i32 pid, String name)>` (platform/macos.rs:1503) and `get_focused_window_title(pid)` (:1640) are currently private `fn` — **promote to `pub`** (like the Windows `get_window_info` promotion) if the walker doesn't already return app/title in `TreeSnapshot` (check `TreeSnapshot`'s fields first — it likely has `app_name`/`window_name`).

## Threading
- AX (cidre) calls must be serialized: a global `AX_QUERY_LOCK` (platform/macos.rs:33) — the walker already uses it. The on-demand tree walk does NOT need a CFRunLoop (only the event-tap + AXObserver paths do). So per-tick `walk_focused_window()` from the daemon's capture thread is fine — mirrors the Windows per-tick approach. (No COM equivalent; do NOT add CoInitialize.)

## Input counts (mac equivalent of Task 2.4b)
macOS uses a CGEventTap for input (platform/macos.rs `run_event_tap` ~726-912) which NEEDS a CFRunLoop + Input Monitoring permission. For counts-only: either reuse the fork's `ActivityFeed` (keyboard count) + add click counting, or run a minimal CGEventTap on a dedicated run-loop thread counting key-down/mouse-down into atomics (mirror 2.4b's WH hooks). COUNTS ONLY — never event content. This is a separate sub-task after the snapshot path works.

## First step on the Mac: compile the fork's mac path
The trim (Task 2.0) only compiled on Windows. On the Mac, FIRST `cargo build --manifest-path vendor/screenpipe/crates/screenpipe-a11y/Cargo.toml` and fix any mac-side trim errors (the `local_compat` repoints in platform/macos.rs, tree/macos.rs were applied but never compiled). THEN build the workspace with the feature on mac.

## Pub promotions likely needed (mac)
- `get_focused_app_info`, `get_focused_window_title` (platform/macos.rs) → `pub` (if not covered by `TreeSnapshot` fields).
- Confirm `MacosTreeWalker`, `TreeWalkerConfig`, `TreeWalkResult`, `TreeSnapshot`, `AccessibilityTreeNode` are `pub` + reachable as `screenpipe_a11y::...` (the walker entry is `pub`; verify the types are exported in lib.rs, promote if needed). Record in VENDOR.md.

## On-Mac test checklist (Task 3.4 — CB12)
Run on the real Mac after the adapter compiles:
1. **Permissions:** grant + deny Accessibility → `readiness()` returns Ready / `Blocked("accessibility")`; denial surfaces `capture_blocked` + the rehearsal, never a silent dead study.
2. **Real capture:** build observerd with the feature, run a short session → real `AxDelta` `ObserverEvent`s reflecting your live windows (app/window names), mirroring the Windows real-capture proof. (Note: the ~1500 events was a one-time count observed in a single manual Windows run, not a CI-asserted constant — the committed `real_ax_capture` test only asserts the capture is non-empty, i.e. ≥1 event.)
3. **C4:** focus a real password field → its value never appears in the store (it's skipped/suppressed). Run the redaction corpus against a live capture.
4. **Input counts:** type/click → `InputBurst` events with non-zero counts; confirm NO keystroke content is stored.
5. **Idle:** >90s idle suspends the walk; resumes on activity.
6. **C6:** measure gate-flip → teardown latency; reconcile the published claim.
7. **Budget:** observe CPU <5% / RSS <300MB under a realistic workday (Activity Monitor).
8. **Daemon independence:** LaunchAgent survives app close + reboot (CB1); menu-bar capture indicator parity (T&C §8.1).
9. **Cutover:** a real captured session + a seeded fixture both produce valid packets through the SAME downstream path (§9).

## Then: Detailed mode (phase 2, both platforms)
Frames + local OCR + OCR-text redaction (CB16) — the depth picker already records the Detailed choice; the capture path is unbuilt. Separate effort after Lite proves out on both platforms.
