# Adversarial gate — Capture Bring-Up (Windows) (2026-06-18)

- **Branch / PR:** `feature/capture-bringup` → `main` (#140)
- **Reviewed diff:** `git diff $(git merge-base origin/main HEAD)..HEAD` (merge-base `15f6778`; your-work-only, 25 commits)
- **Gate run by:** Claude Code (four adversarial reviewers, `.claude/agents/*`) on 2026-06-18 — human sign-off pending on the PR.
- **Scope:** real OS capture — daemon spawn (HKCU autostart), Windows UIA adapter (per-tick AX tree + low-level input-count hooks), trimmed vendored `screenpipe-a11y`, Lite/Detailed depth + consent. macOS deferred (handoff doc).

## CI step
- typecheck: ✅  tests: ✅ (Rust: nibbin-capture 15 incl. screenpipe + idle/input, observerd incl. day14_headless, nibbin-study 13; web: sync-study 8) · build: ✅ (web build; observerd[screenpipe] + nibbin-observer-app)  lint (clippy): ⟳ re-verifies in CI after the fmt fix  audit: ✅  SAST (semgrep): ✅  redaction corpus: ✅ (Rust corpus in the Observer-daemon job; re-runs post-fix)  trigger-graph / Grovemap: ✅
- **fmt:** initial CI failure (`cargo fmt --check`) → fixed (`cargo fmt --all`, `d42a744`); now clean.

## Adversarial reviewers (.claude/agents/*)
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | PASS | 0 | 0 | 4 | 3 |
| claims-auditor | PASS (conditions) | 0 | 3 | 2 | 1 |
| logic-skeptic | FAIL → resolved | 0 | 3 | 3 | 2 |
| cost-auditor (≥M2) | PASS | 0 | 0 | 3 | 2 |

**Core privacy invariants held under attack (red-team):** C1 (no network — zero socket/HTTP deps in capture or the vendored crate), C4 (secure-field value suppressed structurally via `SecureSuppressed`, subtree-inherited), counts-only input (LL hooks `fetch_add` only, never deref `lparam`), C6 within-tick (atomic flip before IO, re-checked per item), migration (idempotent DDL + CHECK), FFI (`ThreadBoundUia` asserts same-thread COM — panic not UB).

## Findings (severity-ranked)

### P1 — all RESOLVED (blocking)
- **LS-01** (P1) `app/src/commands.rs:read_status` — `capture_blocked` was not forwarded from `daemon.status` to the UI, so the capture-blocked banner / P-CB1/P-CB2 rehearsal could never render. **FIX:** forward `capture_blocked` (commit `f353dc2`). Status: resolved.
- **LS-02** (P1) `nibbin-capture/src/windows.rs stop()/Drop` — `CoUninitialize` + `UiaContext` drop ran without a thread guard; an off-thread `Drop` would corrupt the COM apartment (UB). **FIX:** record the creating thread id; off-thread teardown skips `CoUninitialize` and leaks the context (leak ≫ corruption) + warns (`f353dc2`). Status: resolved.
- **LS-03** (P1) `nibbin-capture/src/windows.rs start()/stop()` — hook-thread TID was published inside the spawned closure; a rapid start→stop (e.g. DeleteEverything right after consent) could read TID=0 → no WM_QUIT → `join()` deadlock. **FIX:** `start()` waits (bounded `recv_timeout`) for the hook thread to publish its TID before returning (`f353dc2`). Status: resolved.
- **CA-02** (P1) `nibbin-capture/src/macos.rs` — `MacAxCapture` used the default `readiness()` (Ready), so on macOS the daemon would `start()` (which `bail!`s) instead of surfacing `capture_blocked` (P-CB2). **FIX:** `readiness()` returns `Blocked("macOS capture bring-up pending")` (`f353dc2`). Status: resolved.
- **CA-03** (P1, doc) macOS handoff doc — "like Windows' 1500-event proof" implied a CI-asserted constant; the committed `real_ax_capture` test only asserts ≥1 event. **FIX:** doc reworded to mark 1500 as a one-time manual observation (`f353dc2`/doc). Status: resolved.
- **CA-01** (P1) Detailed mode consent copy promised screenshots/OCR that are unbuilt ("phase 2") — picking Detailed gave a Lite-identical study (false promise). **Plan conflict** (spec made Detailed "selectable now, capture later"); escalated to the human. **DECISION (John):** mark Detailed **"Coming soon", non-selectable** — Lite is the only startable mode; Detailed shown as a roadmap item with honest future-tense copy. **FIX:** depth picker change (CA-01 commit). Status: resolved.

### P2 — tracked, non-blocking for pilot (fix before GA)
- **RT-1** secure-desktop skip is documented but not explicitly wired into the direct-walk path — lock screen is covered only incidentally by `hwnd.is_invalid()` → empty-vec gap. Acceptable (the gap is correct behavior); wire explicit WTS lock-detection before GA.
- **RT-2** HKCU/launchd autostart is registered on first app launch *before* study consent — capture stays consent-gated, but the background process persistence is installed opt-out. Consider deferring registration to first study, or document the posture.
- **RT-3 / C6 (#22)** the "<100ms pause" is in-process (the atomic gate) only; real hotkey→stop latency is bounded by the ~250ms daemon poll. Keep published copy number-free or reconcile to the measured end-to-end number.
- **RT-4** input counts accrued during a pause leak into the first post-resume burst (counts only — soft C6). Minor; reset counters on resume before GA.
- **cost-P2 (dedup)** no tree-hash dedup — every ~250ms tick writes the full AX tree even if unchanged; the fork computes a `tree_hash` the adapter discards. Add hash-based dedup before GA (large store-size lever).
- **cost-P2 (store cap)** SQLCipher store has no row/size ceiling or vacuum; grows until end-of-study/delete. Fine for pilot; cap before GA.
- **cost-P2 (CPU/RSS)** P-CB6 (<5% CPU / <300MB RSS) is verified-on-hardware but unenforced at runtime; a continuously live-updating foreground window re-arms `last_activity` each tick, defeating idle-suspend. Add a process-level throttle (priority class / Job Object) before GA.
- **claims-P2 ×2 / logic-P2 ×3** — see the reviewers' detail; none alter the privacy invariants. Notable: ensure the depth picker's non-selectable Detailed doesn't desync the consent depth label (covered by the CA-01 fix).

### P3 — minor (tracked)
- Reviewer P3s (red-team ×3, claims ×1, logic ×2, cost ×2): doc/comment polish, the `eprintln!`→`log::debug!` C6-timing cleanup, the `apply_pii` inert-field TODO, `local_compat` `pub(crate)` tightening, the 2.4b hook_tid publish note (now closed by LS-03's barrier). None blocking.

## Disposition
- Blocking (P0/P1) resolved: ☑ (6 P1, 0 P0 — all fixed in `f353dc2` + the CA-01 picker commit)
- Non-blocking tracked: ☑ (P2/P3 above — pilot-acceptable; GA follow-ups: tree-hash dedup, store cap, CPU/RSS throttle, explicit lock-detection, autostart-before-consent posture, C6 latency reconciliation)
- **Gate verdict:** PASS (all P0/P1 resolved; P2/P3 tracked as non-blocking pilot follow-ups)
- **Signed:** pending John's sign-off on PR #140 (gate executed by Claude Code's four reviewers)
