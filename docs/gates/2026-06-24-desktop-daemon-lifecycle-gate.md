# Adversarial Gate — PR #257 `fix/desktop-daemon-lifecycle-025` (desktop-v0.2.5)

**Reviewer focus:** privacy (daemon must never capture when it shouldn't) + NSIS installer correctness.
**Date:** 2026-06-24
**Verdict:** PASS-WITH-MINOR

Scope: daemon lifecycle fix — self-suspend watchdog (`observerd/src/watchdog.rs`), kill-on-exit
(`app/src/lib.rs` `RunEvent::Exit` → `daemon_supervisor::stop_spawned_daemon`), NSIS process-kill +
autostart-cleanup hooks (`app/windows/installer-hooks.nsh`), version bump 0.2.4→0.2.5.

---

## Lens 1 — Privacy (the crux)

The decisive fact: **capture is gated by `capture_allowed(snap) == (state == Active)`**
(`crates/nibbin-study/src/lib.rs:276`), checked in `capture_pass()` (`observerd/src/lib.rs:250`).
So capture only happens for an **Active** study, independent of the watchdog. The watchdog bounds the
**process lifetime**; it is genuinely belt-and-suspenders, not the sole capture gate. This is the right
architecture and the reason none of the residuals below are privacy holes.

- **Watchdog conditions are correct, not inverted.** `evaluate()` (watchdog.rs:137):
  Superseded checked first & unconditionally (yields even mid-study — correct, the new install is the
  authority); then for an in-progress (Active|Paused) study it returns `None` after clearing both timers
  (never tears down a live study); StaleTerminal and OrphanedIdle each require a sustained 5-min window
  with `get_or_insert`/reset-on-clear. `study_in_progress_on_disk` fails toward **allowing exit** on an
  unreadable/absent study (fail-closed for lifetime). Logic is sound.
- **It actually STOPS capture, not just logs.** main.rs:62 → `daemon.shutdown_capture()` (`source.stop()`)
  then `return Ok(())` ends the process. Capture source torn down before exit.
- **Expiry is handled independently** of the watchdog: `tick()`/`deadline_passed` fire `StopDay14` +
  `source.stop()` at the deadline (lib.rs:238), flipping state off Active so `capture_allowed` goes false
  on the same pass. An "expired study" therefore stops capturing immediately, not after a 5-min watchdog
  window. Good.
- **Kill-on-exit targets the exact PID** we spawned (`taskkill /F /T /PID <pid>`), recorded in an
  `AtomicU32` at spawn (daemon_supervisor.rs:134). No broad `/IM` that could kill a concurrent newer
  daemon; no-op on PID 0; tolerates already-dead. Correct.
- **No path where capture runs with no Active study.** Confirmed: pre-consent / NotStarted / Paused /
  Complete / Deleted all yield `capture_allowed == false`.

### Residuals (accepted, by design — see IMPORTANT-1)

- **IMPORTANT-1 (accepted residual, document it): app-crash mid-study leaves the daemon capturing until
  the study deadline.** watchdog.rs:151 — OrphanedIdle cannot fire while a study is in progress, so if the
  parent app *crashes* (no `RunEvent::Exit`, no kill-on-exit) during an **Active** study, the orphaned
  daemon keeps capturing (legitimately, study still Active) with no live UI/tray, bounded only by the
  day-14/scan deadline or a superseding install — not by the 5-min orphan window. This is the deliberate
  "never tear down a live study" tradeoff and is acceptable (the user *did* consent to an active study, and
  capture remains gated to Active). **Not a hole**, but it is the one scenario where capture outlives the
  visible app, and the PR/STATE notes should say so explicitly so it isn't mistaken for a regression.

---

## Lens 2 — Installer correctness (NSIS)

- **Macro names verified correct.** `NSIS_HOOK_PREINSTALL`, `NSIS_HOOK_POSTINSTALL`,
  `NSIS_HOOK_PREUNINSTALL`, `NSIS_HOOK_POSTUNINSTALL` are exactly the macros Tauri v2's NSIS bundler
  invokes (confirmed against Tauri v2 docs: PREINSTALL runs before copying files; PREUNINSTALL before
  removing files). No silently-ignored hook.
- **Kill happens BEFORE file mutation.** `NIBBIN_KILL_OBSERVERD` (`taskkill /F /T /IM observerd.exe`) is
  inserted at the top of both PREINSTALL (before binaries are laid down — prevents locked-file failure /
  orphan on upgrade-over-running) and PREUNINSTALL (before file removal — fixes the "fresh install still
  watching" bug). Correct ordering.
- **taskkill non-zero tolerated.** `nsExec::Exec` + `Pop $0` discards the exit code; absent process →
  non-zero is explicitly ignored, installer never aborts. Correct.
- **Autostart cleanup correct.** PREUNINSTALL `DeleteRegValue HKCU
  "Software\Microsoft\Windows\CurrentVersion\Run" "NibbinObserver"` — right hive/path/value (matches
  `register_windows` RUN_VALUE_NAME), no error if absent. `installMode: currentUser` ⇒ HKCU is the correct
  hive.
- `tauri.conf.json` `installerHooks: "windows/installer-hooks.nsh"` — path matches the file location
  (`app/windows/installer-hooks.nsh`), relative to the config dir. Correct.

---

## Lens 3 — Security / robustness

- All taskkill/reg/DeleteRegValue invocations use **static string literals** — no interpolation of
  untrusted data → no command/registry injection.
- Kill-on-exit can't be tricked into killing an unrelated process: it kills a PID we recorded for a child
  *we* spawned. (Theoretical PID-reuse window after the daemon self-exits exists but is unexploitable here
  and bounded by app lifetime.)
- `CREATE_NO_WINDOW` (0x08000000) on spawn and taskkill — no console flash. Best-effort `.status()`
  ignored — appropriate.

---

## Lens 4 — Claims-auditor / will-it-build

Every claim in the commit is backed by the diff: preinstall taskkill ✔, uninstall taskkill ✔, autostart
DeleteRegValue ✔, kill-on-exit via `RunEvent::Exit` ✔, self-suspend watchdog with 3 triggers ✔, version
bump 0.2.5 ✔, `pub mod watchdog` + `shutdown_capture` + lease/heartbeat C3-cleanup ✔.

Build risk: **low.** `is_none_or` (Rust 1.82) and `is_some_and` are already used in the same crates
(`nibbin-study`, `observerd/lib.rs`) and no MSRV (`rust-version`) is pinned, so the toolchain supports
them. `iso_to_unix` is `#[allow(dead_code)]` (no unused-fn failure). Watchdog runs inline on the daemon
tick (no spawned thread to join). CI "Desktop app crate (cargo check)" + "Observer daemon" jobs cover it.

### Minor findings

- **MINOR-1: heartbeat is gated behind `read_status()` succeeding** (`app/src/lib.rs:264,272`). If the
  status file is absent/unreadable (e.g. very first launch before the daemon writes `daemon.status`, or a
  transient read error) the app — though alive — never refreshes `app.heartbeat`. After 5 min a daemon
  with no Active study would self-exit (OrphanedIdle) under a live app. Fail-**closed** (daemon exits, no
  capture leak) so not a privacy issue, but it can prematurely kill a dormant-but-wanted daemon. Consider
  touching the heartbeat unconditionally each second (independent of `read_status`), still skipping only
  the DELETED case.
- **MINOR-2: doc/STATE note for IMPORTANT-1** — record the "app-crash mid-active-study keeps capturing to
  deadline" behavior as intended, so a future reader doesn't read it as the orphan bug recurring.
- **MINOR-3 (cosmetic):** the watchdog poll cadence equals `interval_ms` (250ms) but the windows are 5 min;
  worst-case extra capture for the *lifetime* triggers is ~5 min, and because capture is independently
  gated to Active studies that window captures nothing in the idle/terminal cases. No action needed; noted
  for completeness.

---

## Verdict: PASS-WITH-MINOR

The privacy crux holds: capture is gated to Active studies by `capture_allowed`; the watchdog reliably
bounds process lifetime and fails closed; kill-on-exit targets the exact PID; the NSIS hooks use the
correct Tauri v2 macro names and kill before file/registry mutation. No Critical or Important blockers.

**Must-fix before merge:** none.
**Should-fix (non-blocking):** MINOR-1 (unconditional heartbeat refresh) and MINOR-2 (document the
accepted app-crash-mid-active-study residual).
