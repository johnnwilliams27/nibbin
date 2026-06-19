# Capture Bring-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the staged capture engine into real OS capture — spawn the daemon as an independent background process, wire the macOS AX + Windows UIA adapters to the vendored Screenpipe a11y fork, enforce C4/C6 at the OS level, and add the Lite/Detailed capture-mode choice — so the field study feeds real diagnoses instead of seeded fixtures.

**Architecture:** The daemon (`observerd`) already owns the capture loop, redaction pipeline, day-14 stop, and deletion (it runs fully independent of the Tauri app). What's missing is (1) the app never *registers/launches* the daemon, so `daemon.status` never exists → `DAEMON_OFFLINE` dead-end; (2) the two platform `CaptureSource` adapters are honest `bail!` stubs. This plan adds the daemon registration mechanism, evolves the `CaptureSource` trait so it can carry input-counts (not just AX trees), wires both adapters to the vendored fork, and threads a `depth: lite|detailed` study attribute through the stack. Real capture output flows through the **same** `AxSnapshot → snapshot_to_raw_events → RedactionPipeline → ObserverEvent` path, so nothing downstream changes.

**Tech Stack:** Rust (Tauri 2, `cidre` for macOS AX/CG, `windows` crate for UIA), the vendored `screenpipe-a11y` crate, TypeScript (desktop UI), Supabase migrations.

## Global Constraints

- **C1 — capture has no network.** `nibbin-capture` and `observerd` must never gain an HTTP/socket dependency. The red-team checks this on every capture PR. (`crates/nibbin-capture/src/lib.rs:3-6`)
- **C4 — secure fields suppressed by OS role, structurally.** An OS password/secure field sets `AxSnapshotNode.secure = Some(true)`; `snapshot_to_raw_events` then emits the `SecureSuppressed` variant (no label/value field exists at the type level). Adapters set the flag from the OS role ONLY — never image/heuristic detection. (`crates/nibbin-redaction/src/capture_norm.rs:60-78`, `event.rs:106-118`)
- **C6 — pause is a single atomic flip.** The gate (`crates/nibbin-capture/src/gate.rs`) already kills forwarding wait-free. Adapter teardown on pause must not add latency on that path.
- **P-CB1 — fail loud, never record silently.** A source that cannot capture (no permission, fork error, secure desktop) reports `capture_blocked` and records nothing — it never returns empty while a study burns days believing it's recording.
- **P-CB2 — permission-first.** No observer registers before the OS permission is granted; denial surfaces via `capture_blocked`.
- **P-CB5 — the daemon is independent.** observerd runs as its own LaunchAgent (macOS) / Scheduled Task (Windows). An app-spawned child sidecar is acceptable ONLY as a dev throwaway, never shipped.
- **P-CB6 — budgeted.** Idle >90s suspends observers; steady-state target <5% CPU / <300MB RSS (verified on hardware).
- **Lite ships v1; Detailed is designed but built phase 2.** Lite = a11y tree + input counts + URL/window/nav, NO Screen Recording permission. Detailed = + frames + local OCR (Screen Recording), opt-in.
- **Brand voice:** plain language, no jargon in user copy ("admin work"/"creative work", not "a11y vs frames"). Lite is the pre-selected, recommended default.
- **Next Supabase migration number:** `20260618030000_*` (latest is `20260618020000_promotion_gate_v3_stakes.sql`).
- **Provenance:** the vendored fork is MIT; keep the frozen-commit note in `vendor/screenpipe/` (CB11).

---

## File Structure

**Phase 1 — Daemon spawn (CB1/CB2):**
- Create: `apps/desktop/src-tauri/app/src/daemon_supervisor.rs` — resolves the bundled observerd path, registers/starts it per-OS, exposes `ensure_daemon_running(app)`.
- Modify: `apps/desktop/src-tauri/app/src/lib.rs` — call `ensure_daemon_running` in `setup()`; add `daemon_health` to the status payload.
- Modify: `apps/desktop/src-tauri/app/tauri.conf.json` — bundle observerd (resource/externalBin).
- Modify: `apps/desktop/src-tauri/app/Cargo.toml` — `mod daemon_supervisor` deps if any (dirs, plist writing via std).
- Create: `apps/desktop/src-tauri/app/resources/launchagent.plist.template` — macOS plist template.
- Test: `apps/desktop/src-tauri/app/tests/daemon_supervisor.rs` — plist/scheduled-task content generation (pure-function tests, no actual OS registration in CI).

**Phase 2 — Capture foundation + Windows UIA (CB3-shared, CB4, CB5/6/8/9/10 Windows):**
- Modify: `crates/nibbin-capture/src/lib.rs` — evolve `CaptureSource`: add `readiness()`, change `poll()` to drain `Vec<CaptureItem>`; add `CaptureItem`, `CaptureReadiness`, `InputCounts` types.
- Modify: `crates/nibbin-capture/src/mock.rs` — update mock to the new trait.
- Modify: `crates/nibbin-capture/src/windows.rs` — wire `WindowsUiaCapture` to `screenpipe-a11y` windows_uia.
- Create: `crates/nibbin-capture/src/map.rs` — pure `AccessibilityNode → AxSnapshotNode` / `ElementContext → AxSnapshot` mapping (shared by both adapters; unit-testable without hardware).
- Modify: `crates/nibbin-capture/Cargo.toml` — depend on `screenpipe-a11y` under the `screenpipe` feature; enable by default for win/mac targets.
- Modify: `observerd/src/lib.rs` — `capture_pass` drains `CaptureItem`s (AX snapshots → existing path; input counts → InputBurst events directly); call `readiness()` and set `capture_blocked` on `Blocked`.

**Phase 3 — macOS AX adapter (CB3 mac):**
- Modify: `crates/nibbin-capture/src/macos.rs` — wire `MacAxCapture` to `screenpipe-a11y` macos (permissions, AXObservers, CGEventTap counts, AXSecureTextField→secure), reusing `map.rs`.
- Create: `apps/desktop/src-tauri/app/entitlements.plist` additions if needed (Input Monitoring / Accessibility usage strings live in Info.plist).

**Phase 4 — Lite/Detailed depth + consent UX (CB15/CB17):**
- Modify: `crates/nibbin-study/src/lib.rs` — add `CaptureDepth { Lite, Detailed }` enum + `depth` field on `StudySnapshot` + `CreateStudy` + `new_study`.
- Modify: `apps/desktop/src/core/study-machine.ts` — TS mirror: `StudyDepth` type + `depth` on snapshot/command/newStudy.
- Modify: `apps/desktop/src/ui/bridge.ts` — `createStudy(id, kind, label, depth)`.
- Modify: `apps/desktop/src-tauri/app/src/commands.rs` — `create_study` accepts + validates `depth`.
- Modify: `observerd/src/lib.rs` — `CreateStudy` control command carries `depth`.
- Modify: `apps/desktop/src/ui/views/consent.ts` + `field-study.ts` — depth picker step (use-case framed, Lite default).
- Modify: `apps/desktop/src/ui/views/study.ts`, `notes.ts`, `field-study.ts` (quickScanView), `app/src/lib.rs` (tray) — surface chosen depth.
- Create: `supabase/migrations/20260618030000_diagnoses_depth.sql` — `depth` column on diagnoses.
- Modify: `apps/web/app/api/study/packet/route.ts` — ingest `packet.depth`.

---

## Phase 1 — Daemon Spawn Lifecycle (CB1/CB2)

**Why first:** Without this, a study can never run on any real machine — `daemon.status` never exists, `read_status` returns `DAEMON_OFFLINE`, the study can't leave `NOT_STARTED`. This is the single highest-leverage fix and is verifiable on this Windows machine.

**Design decisions locked:**
- observerd is **bundled as a Tauri resource** (not run as an app child). The app resolves its path via `app.path().resource_dir()` and registers it with the OS scheduler.
- **macOS:** write `~/Library/LaunchAgents/app.nibbin.observerd.plist` (`RunAtLoad`+`KeepAlive`, `ProgramArguments = [<observerd>, --store, <store_root>]`), then `launchctl bootout gui/$UID` (ignore failure) + `launchctl bootstrap gui/$UID <plist>`.
- **Windows:** register an `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` value (`NibbinObserver` = `"<observerd>" --store "<store>"`) via `reg add` (no new crate). **DECISION (user, 2026-06-18, verified on hardware):** Scheduled Task creation requires UAC elevation on Windows 10 Home even with a LeastPrivilege `<Principal>` (both `/XML` and `/SC ONLOGON` forms return Access Denied non-elevated) — and `register_windows` runs silently on app launch, so it must never prompt. HKCU Run is the unprivileged, works-everywhere choice. Trade-off accepted: no OS restart-on-crash mid-session (the daemon is crash-resistant and relaunches at next login). observerd release builds use the Windows GUI subsystem so the daemon does not flash a console window at login.
- `ensure_daemon_running` is **idempotent** — re-running the app re-asserts registration without duplicating.
- New status field `daemon_health`: when registration fails, `read_status` surfaces `{"state":"DAEMON_OFFLINE","daemon_health":"<reason>"}` so the UI shows an honest install-failure note instead of a transient "starting" forever (CB2).

### Task 1.1: Bundle observerd as a resource + path resolver

**Files:**
- Modify: `apps/desktop/src-tauri/app/tauri.conf.json:41-66` (bundle block)
- Create: `apps/desktop/src-tauri/app/src/daemon_supervisor.rs`
- Modify: `apps/desktop/src-tauri/app/src/lib.rs:6-8` (add `mod daemon_supervisor;`)
- Test: `apps/desktop/src-tauri/app/tests/daemon_supervisor.rs`

**Interfaces:**
- Produces: `daemon_supervisor::observerd_path(app: &AppHandle) -> anyhow::Result<PathBuf>` — the bundled binary path; `daemon_supervisor::store_root_for(app)` reuses `commands::store_root`.

- [ ] **Step 1: (no tauri.conf.json change here.)** Bundling is deferred to Task 1.6. Tauri's `externalBin` enforces a *compile-time* binary-existence check, which would force committing a placeholder binary (a 0-byte-daemon landmine) and break `tauri dev`. Instead Task 1.6 uses `bundle.resources` (validated only at `tauri build`, not at compile time). This task only adds the resolver + test; the resolver's resource-dir lookup + dev sibling fallback work without any bundle config. Add `apps/desktop/src-tauri/app/binaries/` to `.gitignore` so locally-built daemons are never committed.

- [ ] **Step 2: Write the failing test for path resolution shape.** In `tests/daemon_supervisor.rs`, test that `observerd_binary_name()` returns `"observerd.exe"` on Windows and `"observerd"` elsewhere (a pure helper — full `AppHandle` path resolution is integration-tested manually).

```rust
#[test]
fn binary_name_is_platform_correct() {
    let name = nibbin_observer_app::daemon_supervisor::observerd_binary_name();
    #[cfg(windows)] assert_eq!(name, "observerd.exe");
    #[cfg(not(windows))] assert_eq!(name, "observerd");
}
```

- [ ] **Step 3: Run it, expect FAIL** (`cargo test -p app daemon_supervisor` → unresolved module). 

- [ ] **Step 4: Implement `observerd_binary_name()` + `observerd_path()`** in `daemon_supervisor.rs`:

```rust
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

pub fn observerd_binary_name() -> &'static str {
    if cfg!(windows) { "observerd.exe" } else { "observerd" }
}

/// Resolve the bundled observerd binary. In dev (`tauri dev`) the binary is the
/// sibling debug build; in a bundle it is under the resource dir.
pub fn observerd_path<R: Runtime>(app: &AppHandle<R>) -> anyhow::Result<PathBuf> {
    let name = observerd_binary_name();
    let resource = app.path().resource_dir().ok().map(|d| d.join(name));
    if let Some(p) = resource { if p.exists() { return Ok(p); } }
    // dev fallback: target/<profile>/observerd next to the app binary
    let exe = std::env::current_exe()?;
    let sibling = exe.with_file_name(name);
    anyhow::ensure!(sibling.exists(), "observerd binary not found (resource or sibling)");
    Ok(sibling)
}
```

- [ ] **Step 5: Run test, expect PASS.** Commit: `feat(desktop): bundle observerd + resolve its path`.

### Task 1.2: macOS LaunchAgent registration (pure plist generation + register fn)

**Files:**
- Modify: `apps/desktop/src-tauri/app/src/daemon_supervisor.rs`
- Test: `apps/desktop/src-tauri/app/tests/daemon_supervisor.rs`

**Interfaces:**
- Produces: `launchagent_plist(observerd: &Path, store: &Path) -> String`; `#[cfg(target_os="macos")] register_macos(observerd, store) -> anyhow::Result<()>`.

- [ ] **Step 1: Write the failing test** — assert the generated plist contains the label, both ProgramArguments paths, `--store`, and `RunAtLoad`/`KeepAlive` true:

```rust
#[test]
fn plist_has_required_keys() {
    let p = nibbin_observer_app::daemon_supervisor::launchagent_plist(
        std::path::Path::new("/Applications/Nibbin.app/observerd"),
        std::path::Path::new("/Users/x/Library/Application Support/app.nibbin.observer/observer-store"),
    );
    assert!(p.contains("app.nibbin.observerd"));
    assert!(p.contains("<string>--store</string>"));
    assert!(p.contains("/observerd</string>"));
    assert!(p.contains("RunAtLoad"));
    assert!(p.contains("KeepAlive"));
}
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `launchagent_plist` + `register_macos`:**

```rust
use std::path::Path;

pub const LAUNCH_LABEL: &str = "app.nibbin.observerd";

pub fn launchagent_plist(observerd: &Path, store: &Path) -> String {
    format!(r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{obs}</string>
    <string>--store</string>
    <string>{store}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
</dict></plist>"#,
        label = LAUNCH_LABEL,
        obs = observerd.display(),
        store = store.display())
}

#[cfg(target_os = "macos")]
pub fn register_macos(observerd: &Path, store: &Path) -> anyhow::Result<()> {
    use std::process::Command;
    let home = std::env::var("HOME")?;
    let dir = Path::new(&home).join("Library/LaunchAgents");
    std::fs::create_dir_all(&dir)?;
    let plist = dir.join(format!("{LAUNCH_LABEL}.plist"));
    std::fs::write(&plist, launchagent_plist(observerd, store))?;
    let uid = unsafe { libc::getuid() };
    let domain = format!("gui/{uid}");
    // bootout is best-effort (no-op if not loaded); bootstrap (re)loads it.
    let _ = Command::new("launchctl").args(["bootout", &domain, plist.to_str().unwrap()]).status();
    let ok = Command::new("launchctl").args(["bootstrap", &domain, plist.to_str().unwrap()]).status()?;
    anyhow::ensure!(ok.success(), "launchctl bootstrap failed");
    Ok(())
}
```

(If `libc` is not already a dep, read the uid via `Command::new("id").arg("-u")` instead to avoid a new dependency — prefer the `id` route to honor the minimal-deps constraint.)

- [ ] **Step 4: Run test, expect PASS.** Commit: `feat(desktop): macOS LaunchAgent registration for observerd`.

### Task 1.3: Windows autostart via HKCU\...\Run (unprivileged)

**Decision (user-chosen, hardware-verified):** Scheduled Task creation needs UAC elevation on Windows 10 Home even with a LeastPrivilege `<Principal>` — unacceptable for silent launch-time registration. Ship the unprivileged `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` value (via `reg add`, no new crate). No OS restart-on-crash (daemon is crash-resistant + relaunches next login). observerd release builds use the Windows GUI subsystem so no console window flashes at login.

**Files:**
- Modify: `apps/desktop/src-tauri/app/src/daemon_supervisor.rs`
- Modify: `apps/desktop/src-tauri/observerd/src/main.rs` (Windows GUI subsystem on release)
- Test: `apps/desktop/src-tauri/app/tests/daemon_supervisor.rs`

**Interfaces:**
- Produces: `RUN_VALUE_NAME: &str` (= `"NibbinObserver"`); `run_command_line(observerd: &Path, store: &Path) -> String`; `#[cfg(windows)] register_windows(observerd, store) -> anyhow::Result<()>`.

- [ ] **Step 1: Write the failing test** — assert the Run command line quotes the observerd path and carries the `--store` arg:

```rust
#[test]
fn run_command_line_quotes_paths_and_store() {
    let cmd = nibbin_observer_app::daemon_supervisor::run_command_line(
        std::path::Path::new("C:/Program Files/Nibbin/observerd.exe"),
        std::path::Path::new("C:/Users/x/AppData/Roaming/app.nibbin.observer/observer-store"),
    );
    assert!(cmd.contains("observerd.exe"));
    assert!(cmd.contains("--store"));
    assert!(cmd.starts_with('"')); // path quoted so spaces (Program Files) survive
}
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `run_command_line` + `register_windows`** (writes the HKCU Run value via `reg add`):

```rust
pub const RUN_VALUE_NAME: &str = "NibbinObserver";

/// The HKCU\...\Run value data: the quoted observerd path + --store arg.
pub fn run_command_line(observerd: &Path, store: &Path) -> String {
    format!("\"{}\" --store \"{}\"", observerd.display(), store.display())
}

#[cfg(windows)]
pub fn register_windows(observerd: &Path, store: &Path) -> anyhow::Result<()> {
    use std::process::Command;
    let data = run_command_line(observerd, store);
    let status = Command::new("reg")
        .args([
            "add", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v", RUN_VALUE_NAME, "/t", "REG_SZ", "/d", &data, "/f",
        ])
        .status()?;
    anyhow::ensure!(status.success(), "reg add (HKCU Run) failed");
    Ok(())
}
```

- [ ] **Step 4: Avoid the login console flash.** At the top of `observerd/src/main.rs` add:
  `#![cfg_attr(all(target_os = "windows", not(debug_assertions)), windows_subsystem = "windows")]`
  (release Windows builds run with no console; debug keeps the console for testing.)

- [ ] **Step 5: Run test (PASS) + verify real non-elevated registration** on this machine: `reg add HKCU\...\Run` succeeds with no admin, then `reg delete` cleanup. Commit: `feat(desktop): unprivileged Windows autostart via HKCU Run`.

### Task 1.4: `ensure_daemon_running` + wire into setup() + honest health surface

**Files:**
- Modify: `apps/desktop/src-tauri/app/src/daemon_supervisor.rs`
- Modify: `apps/desktop/src-tauri/app/src/lib.rs:172-246` (setup), `commands.rs:39-56` (read_status adds `daemon_health`)

**Interfaces:**
- Consumes: `commands::store_root`, `observerd_path`, `register_macos`/`register_windows`.
- Produces: `ensure_daemon_running(app) -> ()` (never panics; records failure for status).

- [ ] **Step 1:** Add `ensure_daemon_running`:

```rust
pub fn ensure_daemon_running<R: Runtime>(app: &AppHandle<R>) {
    let result = (|| -> anyhow::Result<()> {
        let obs = observerd_path(app)?;
        let store = crate::commands::store_root(app)?;
        #[cfg(target_os = "macos")] { register_macos(&obs, &store)?; }
        #[cfg(windows)] { register_windows(&obs, &store)?; }
        Ok(())
    })();
    if let Err(e) = result {
        // honest health surface (CB2): write a health note next to the store so
        // read_status can show an install-failed state instead of a forever-spinner.
        if let Ok(store) = crate::commands::store_root(app) {
            let _ = std::fs::write(store.join("daemon.health"), format!("install_failed: {e}"));
        }
        eprintln!("daemon registration failed: {e}");
    } else if let Ok(store) = crate::commands::store_root(app) {
        let _ = std::fs::remove_file(store.join("daemon.health")); // clear stale failure
    }
}
```

- [ ] **Step 2:** In `lib.rs` `setup()` (before the status-refresher thread, ~line 192) add: `daemon_supervisor::ensure_daemon_running(&app.handle());`

- [ ] **Step 3:** In `commands.rs::read_status`, when `daemon.status` is absent, include the health note:

```rust
Err(_) => {
    let health = std::fs::read_to_string(root.join("daemon.health")).ok();
    serde_json::json!({ "state": "DAEMON_OFFLINE", "daemon_health": health })
}
```
and add `"daemon_health": status.get("daemon_health")` to the returned object.

- [ ] **Step 4:** Manual verification (Windows, this machine): build + run the app; confirm `schtasks /Query /TN NibbinObserver` lists the task, `daemon.status` appears under `%APPDATA%/app.nibbin.observer/observer-store`, and `study_status` flips from `DAEMON_OFFLINE` to a real state. Commit: `feat(desktop): register + start observerd on app launch (CB1/CB2)`.

### Task 1.5: UI — DAEMON_OFFLINE becomes transient; honest install-failure note

**Files:**
- Modify: `apps/desktop/src/ui/views/field-study.ts` (the `showDaemonNote`/`onRetry` path, ~line 230-296)
- Modify: `apps/desktop/src/ui/bridge.ts` (surface `daemon_health` from status)

- [ ] **Step 1:** Thread `daemon_health` from `study_status` through the bridge type.
- [ ] **Step 2:** In the entry view's daemon-note branch: if `daemon_health` is set, show the honest copy ("Nibbin couldn't start its background recorder — <reason>. Retry / contact support.") instead of the transient "starting…" note. If unset and status is `DAEMON_OFFLINE`, show "Starting the recorder…" with the existing `pollUntilOnline` retry.
- [ ] **Step 3:** Manual check in `tauri dev`. Commit: `feat(desktop): transient vs install-failed daemon states in Field Study entry`.

### Task 1.6: Release pipeline — build + stage observerd for bundling

**Files:**
- Modify: `.github/workflows/desktop-release.yml` (build observerd, stage it for bundling)
- Modify: `apps/desktop/src-tauri/app/tauri.conf.json` (add `bundle.resources`)

- [ ] **Step 1:** In tauri.conf.json `bundle`, add a `resources` MAP that places the built binary at the resource ROOT (so it matches `observerd_path`'s `resource_dir().join(name)` lookup), e.g. `"resources": { "binaries/observerd": "observerd" }` (and the `.exe` variant on Windows). Using a map (not a bare glob) flattens the path so the resolver finds it at the resource root. `bundle.resources` is checked only at `tauri build`, so `tauri dev` and local compiles are unaffected.
- [ ] **Step 2:** Add a CI build step `cargo build -p observerd --release --features os-keystore` and copy the binary to `apps/desktop/src-tauri/app/binaries/observerd[.exe]` before `tauri build` runs (per-OS in the matrix). Since `binaries/` is gitignored (Task 1.1), this is a CI-staging step, never committed.
- [ ] **Step 3:** Verify the bundle includes observerd at the resource root (inspect a CI artifact; the resolver's `resource_dir().join("observerd[.exe]")` must resolve). Commit: `ci(desktop): build + stage observerd for bundling via bundle.resources`.

**Phase 1 done when:** on this Windows machine the app registers + starts observerd, `daemon.status` appears, and the Field Study leaves `DAEMON_OFFLINE`; install failure shows an honest note, not a spinner.

---

## Phase 2 — Capture Foundation + Windows UIA (CB3 shared, CB4, CB5/6/8/9/10)

**Why before macOS:** this is a Windows machine — Windows UIA can be brought up AND verified here end-to-end. The trait evolution + mapping + daemon wiring done here is shared, so macOS (Phase 3) only adds the mac FFI.

**Design decisions locked:**
- **Trait evolution (resolves the input-counts gap).** Today `poll() -> Vec<AxSnapshot>` can only express AX trees, so `InputBurst` has no live path (the only `InputRef` built is the pause-gap). Evolve the trait to drain a richer item:

```rust
pub enum CaptureItem {
    Snapshot(AxSnapshot),       // → existing snapshot_to_raw_events path (AxDelta)
    Input(InputCounts),         // → InputBurst ObserverEvent (no content, no NER)
}
pub struct InputCounts { pub keys: u32, pub clicks: u32, pub duration_ms: u64 }

pub enum CaptureReadiness { Ready, Blocked(String) }  // Blocked → capture_blocked

pub trait CaptureSource: Send {
    fn name(&self) -> &'static str;
    fn readiness(&self) -> CaptureReadiness;   // NEW: permission/health pre-check
    fn start(&mut self) -> anyhow::Result<()>;
    fn poll(&mut self) -> anyhow::Result<Vec<CaptureItem>>;  // CHANGED return type
    fn stop(&mut self);
}
```

- **Why `CaptureItem` not a parallel `poll_input`:** keeps a single drain point + preserves ordering; the trait doc already promised "event-driven … input burst boundaries". Input counts carry **no content**, so they bypass NER — the daemon builds the `InputBurst` `ObserverEvent` directly (same shape the pause-gap already builds).
- **C4 via mapping:** `map.rs` sets `AxSnapshotNode.secure = Some(true)` from `AccessibilityNode.is_password == Some(true)` (Windows) / `role == "AXSecureTextField"` (mac). Redaction does the rest, unchanged.
- **Lite-only for v1:** adapters never request Screen Recording. **OPEN QUESTION TO RESOLVE IN TASK 2.3a:** confirm the fork's `UiRecorder` a11y path does not trigger Screen-Recording permission; if it does, use the lower-level tree-walk APIs directly (`UiaContext::capture_window_tree` on Windows) rather than the high-level recorder.

### Task 2.1: Evolve the `CaptureSource` trait + update MockCapture

**Files:**
- Modify: `crates/nibbin-capture/src/lib.rs:25-55`
- Modify: `crates/nibbin-capture/src/mock.rs`
- Test: `crates/nibbin-capture/src/mock.rs` (existing tests updated) + new readiness test

**Interfaces:**
- Produces: `CaptureItem`, `InputCounts`, `CaptureReadiness`, the new `CaptureSource` trait (signatures above).

- [ ] **Step 1: Write failing tests** — Mock returns `Ready` from `readiness()`, and a queued snapshot drains as `CaptureItem::Snapshot`; a queued input drains as `CaptureItem::Input`.
- [ ] **Step 2: Run, expect FAIL** (type/method missing).
- [ ] **Step 3: Add the new types + trait to `lib.rs`; update `MockCapture`** to hold a `Vec<CaptureItem>` queue, return `Ready`, drain on poll. Keep the existing snapshot-feeding test helper but wrap results in `CaptureItem::Snapshot`.
- [ ] **Step 4: Run, expect PASS.** Commit: `feat(capture): evolve CaptureSource to drain CaptureItem + readiness (CB5/CB-input)`.

### Task 2.2: Daemon consumes `CaptureItem` + readiness → capture_blocked

**Files:**
- Modify: `observerd/src/lib.rs:216-255` (capture_pass), `286-309` (handle Start)

- [ ] **Step 1: Write failing test** (in `observerd/tests/`): feed a Mock a `CaptureItem::Input{keys:5,clicks:2,duration_ms:1200}`; after a capture pass, the store contains one `InputBurst` `ObserverEvent` with `input = Some(InputRef{keys:5,clicks:2,duration_ms:1200})`, `ax = None`. (Use the existing headless test harness + `NIBBIN_TEST_KEY_HEX`.)
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** In `capture_pass`, replace the `for snapshot in snapshots` loop:
  - `CaptureItem::Snapshot(s)` → existing `snapshot_to_raw_events(&s, ...)` → pipeline.
  - `CaptureItem::Input(c)` → build an `InputBurst` `ObserverEvent` directly (mirror `record_gap`'s construction but `kind: InputBurst`, real counts, `app/window` from the last-known focused snapshot or `Observer`/`w_unknown` placeholder) and `store.append`. No NER.
  - In `handle(Start)`: before `source.start()`, call `source.readiness()`; on `Blocked(reason)` set `self.capture_blocked = Some(format!("permission: {reason}"))` and DO NOT start (P-CB2); on `Ready` start as today and clear any prior permission block.
- [ ] **Step 4: Run, expect PASS** + `day14_headless` still green. Commit: `feat(observerd): persist InputBurst + gate Start on capture readiness (P-CB1/P-CB2)`.

### Task 2.0: Make `screenpipe-a11y` self-contained + Windows-compiling (trim siblings) — PREREQUISITE for 2.3/2.4/3.x

**Discovery (2026-06-18, verified):** The vendored `screenpipe-a11y` does NOT compile — it has required path deps `screenpipe-core` + `screenpipe-config` that were never vendored (only `screenpipe-a11y` is present). `VENDOR.md` always intended "trim the sibling dependencies at bring-up"; this task does that. Strategy A (trim) over reimplement — preserves the hardware-proven capture code (spec §3.1).

**Sibling usage to trim (from grep) — all replaced with LOCAL code, NO network fetch needed:**
- `screenpipe_core::pii_removal::remove_pii` (platform/{macos,windows,linux}.rs) → **DROP** (replace `remove_pii(x)` with `x`): Nibbin's 4-layer redaction (C4) is authoritative; a second PII heuristic is redundant and unwanted.
- `screenpipe_core::window_pattern::{self, WindowPattern}` (config.rs, tree/{macos,windows,linux}.rs) → **replace with a tiny local capture-everything STUB module.** Nibbin does NOT use the fork's `ignored_windows`/`included_windows` scoped filtering — Nibbin filters via its own `UserExclusions` + redaction downstream. So a stub where `matches_any → false` (ignore nothing), `passes_includes(included,…) → included.is_empty()` (allow all when no include-list), `WindowPattern::parse_list → vec![]` makes `should_capture_*` "capture everything" — exactly Nibbin's desired behavior. The hardcoded `excluded_apps` (1Password/Bitwarden/…) substring check + the `excluded_window_patterns` regex check stay (they don't use window_pattern) — keep skipping password managers.
- `screenpipe_config::{screen_is_locked,set_screen_locked}` (windows_uia.rs — secure-desktop/lock detection we WANT for CB4) → **reimplement locally** (~10 lines: a `static AtomicBool` + getter/setter). Faithful to the fork's global-flag semantics.
- `screenpipe_core::paths::default_screenpipe_data_dir()` (macos.rs ~1781/1810) → replace with a `dirs`-based path (`dirs` already a dep).
- `screenpipe_db::InsertUiEvent` (events.rs `to_db_insert`) → behind the optional `db` feature; keep `db` OFF and ensure it's `#[cfg(feature="db")]`-gated so no `screenpipe-db` dep is needed.

**Files:**
- Modify: `vendor/screenpipe/crates/screenpipe-a11y/Cargo.toml` (remove the 3 path deps; keep `db` optional/off)
- Create: `vendor/screenpipe/crates/screenpipe-a11y/src/local_compat.rs` (the `window_pattern` capture-everything stub + the `screen_is_locked/set_screen_locked` lock flag) + `mod local_compat;` in lib.rs
- Modify: `src/{config.rs,events.rs,platform/*.rs,tree/*.rs}` (repoint the sibling `use`s to `crate::local_compat`; drop remove_pii; dirs for data dir). Delete the fork's config tests that exercise the stubbed window-scoping (`test_user_window_filters`, `test_scoped_*`, `test_cached_pattern_path...`) — they test a feature we deliberately stubbed; KEEP `test_default_config`, `test_app_exclusion`, `test_window_exclusion`, `test_password_field_detection`.
- Modify: `vendor/screenpipe/VENDOR.md` ("Local modifications": record the trim).

**Steps:**
- [ ] Create `local_compat.rs` with the window_pattern stub (signatures matching every call site in config.rs + tree/*.rs) + the lock-state flag.
- [ ] Remove the `screenpipe-core`/`screenpipe-config` path deps from Cargo.toml; keep `screenpipe-db` only behind the off-by-default `db` feature (or drop it if gating is unclean).
- [ ] Repoint all sibling `use`s to `crate::local_compat`; replace `remove_pii(x)`→`x`; replace `default_screenpipe_data_dir()` with a `dirs`-based path. Fix/trim the config tests as above.
- [ ] Verify `cargo build -p screenpipe-a11y --manifest-path .../Cargo.toml` compiles on Windows (add screenpipe-a11y to the workspace members OR build via its own manifest). Record modifications in VENDOR.md.
- [ ] Commit: `chore(vendor): trim screenpipe-a11y to self-contained (local_compat stub; drop core/config/db siblings) so it compiles`.

**Note:** this task does NOT add `screenpipe-a11y` as a dep of `nibbin-capture` yet (that's 2.3/2.4) — it just makes the vendored crate build on its own.

### Task 2.3: Pure mapping `map.rs` (AccessibilityNode/ElementContext → AxSnapshot)

**Files:**
- Create: `crates/nibbin-capture/src/map.rs`
- Modify: `crates/nibbin-capture/src/lib.rs` (`mod map;`)
- Test: `crates/nibbin-capture/src/map.rs` (unit tests — fully hardware-free)

**Interfaces:**
- Produces: `map::node_to_ax(node: &screenpipe_a11y::AccessibilityNode) -> AxSnapshotNode`; `map::window_tree_to_snapshot(snap: &WindowTreeSnapshot, url: Option<String>) -> AxSnapshot`.

- [ ] **Step 1: Write failing tests** — a `AccessibilityNode{control_type:"Edit", value:Some("hi"), is_password:Some(true), ..}` maps to `AxSnapshotNode{ role:"Edit", value:Some("hi"), secure:Some(true) }`; children recurse; `is_password:None/Some(false)` → `secure:None`. A `WindowTreeSnapshot` maps app/title into `AxWindow` and the root tree into `ax_tree`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement the pure mapping** (this is plain data transformation, fully writable now):

```rust
use nibbin_redaction::capture_norm::{AxSnapshot, AxSnapshotNode, AxWindow};
use screenpipe_a11y::{AccessibilityNode, WindowTreeSnapshot};

pub fn node_to_ax(n: &AccessibilityNode) -> AxSnapshotNode {
    AxSnapshotNode {
        role: n.control_type.clone(),
        label: n.name.clone(),
        value: n.value.clone(),
        secure: if n.is_password == Some(true) { Some(true) } else { None },
        action: None,
        children: n.children.iter().map(node_to_ax).collect(),
    }
}

pub fn window_tree_to_snapshot(s: &WindowTreeSnapshot, url: Option<String>) -> AxSnapshot {
    AxSnapshot {
        window: AxWindow {
            app: s.app_name.clone(),
            bundle_id: None,
            title: s.window_title.clone().unwrap_or_default(),
            category: None,
            id: None,
        },
        url,
        ax_tree: node_to_ax(&s.root),
        frame_ref: None, // Lite: no frames
    }
}
```

(Note: `AxSnapshotNode`/`AxWindow`/`AxSnapshot` fields are `Deserialize`-only today; this task also adds `#[derive(Default)]`/public construction or a constructor in `capture_norm.rs` if the structs aren't externally constructible — verify and adjust. If they expose public fields they're already constructible.)

- [ ] **Step 4: Run, expect PASS.** Commit: `feat(capture): pure AccessibilityNode→AxSnapshot mapping with C4 secure flag`.

### Task 2.3a: Confirm Lite a11y path needs no Screen Recording (spike)

- [ ] Read `vendor/screenpipe/crates/screenpipe-a11y/src/platform/windows_uia.rs` + the `UiRecorder` start path: confirm whether enabling a11y capture pulls in any screen-frame/Screen-Recording code. Decision recorded in the plan + commit message. If frames are entangled, Task 2.4 uses `UiaContext::capture_window_tree` directly (tree-walk per tick) instead of the high-level `UiRecorder`.

### Task 2.4: Wire `WindowsUiaCapture` to the fork (CB4)

**Files:**
- Modify: `crates/nibbin-capture/src/windows.rs:8-45`
- Modify: `crates/nibbin-capture/Cargo.toml` (add `screenpipe-a11y` dep under `screenpipe` feature, enabled for `cfg(windows)`)

**Interfaces:**
- Consumes: `map::window_tree_to_snapshot`, `CaptureItem`, `CaptureReadiness`, the fork's `UiaContext`/`UiRecorder`, `UIA_IsPasswordPropertyId` (already cached by the fork).

- [ ] **Step 1: Cargo wiring** — add `screenpipe-a11y = { path = "../../../vendor/screenpipe/crates/screenpipe-a11y", optional = true }`, `screenpipe = ["dep:screenpipe-a11y"]`, and enable the feature for Windows builds (`[target.'cfg(windows)'.dependencies]` or default for the daemon's win build).
- [ ] **Step 2:** Implement `readiness()` → on Windows UIA needs no special grant; return `Ready` (secure-desktop is handled per-poll, not as a global block).
- [ ] **Step 3:** Implement `start()` — initialize the UIA context (COM init on the capture thread), register the foreground/focus event hook, and a low-overhead keyboard/mouse counter (WH_KEYBOARD_LL/WH_MOUSE_LL or the fork's input tap) that accumulates **counts only**. Buffer focused-window tree snapshots + input counts internally. On secure desktop / UAC (cannot capture) skip-with-visible-gap (don't error). Idle >90s suspends the tree-walk (P-CB6).
- [ ] **Step 4:** Implement `poll()` — drain buffered `CaptureItem::Snapshot` (from `capture_window_tree(focused_hwnd)` → `window_tree_to_snapshot`) and `CaptureItem::Input` (accumulated counts since last poll), then reset counters.
- [ ] **Step 5:** Implement `stop()` — unhook + COM uninit; safe to call twice.
- [ ] **Step 6: Verify on THIS machine** — run observerd with the real Windows source against a short live session: confirm a real `ObserverEvent[]` lands, a password field (`is_password`) yields `SecureSuppressed` (C4), input counts appear as `InputBurst`, and idle suspends. Commit: `feat(capture): wire WindowsUiaCapture to vendored fork (CB4, C4, input counts)`.

### Task 2.5: Budgets + C6 teardown latency measurement (CB7/CB9, Windows)

- [ ] Add idle-suspend (>90s no input/focus change → stop tree-walking, wake on activity) and a coarse RSS/CPU self-check that flags `capture_blocked = "budget exceeded"` rather than running unbounded.
- [ ] Add a debug timing hook around gate-flip → observers-stop and log it; record the measured Windows number for the C6 claim reconciliation (#22). Commit: `feat(capture): idle-suspend + budget guard + C6 teardown timing (Windows)`.

**Phase 2 done when:** a real Windows capture session produces a valid `ObserverEvent[]` (AxDelta + InputBurst), secure fields are suppressed by OS role, permission/secure-desktop unhappy paths surface honestly, and idle suspends — all verified on this machine.

---

## Phase 3 — macOS AX Adapter (CB3)

**Built here, tested by the user on a Mac.** Reuses the Phase 2 trait, `map.rs`, and daemon wiring; only the mac FFI is new. The FFI glue (cidre AXObserver registration, CGEventTap) is implemented against the compiler + the vendored fork's documented entry points; the mapping + daemon paths are already test-covered.

**Fork entry points (from the API survey):** `UiRecorder::check_permissions() -> PermissionStatus{accessibility, input_monitoring}`, `request_permissions()`, `check_input_monitoring()`, `get_focused_element_context(&config) -> Option<ElementContext>` (role/name/value/bounds), AXObserver registration via `ax::Observer::with_cb(pid, cb)` + `add_notification(...)`, NSWorkspace activation notifications, CGEventTap for input counts. Secure: `role == "AXSecureTextField"` → secure.

### Task 3.1: Cargo + permission readiness (mac)

- [ ] Enable `screenpipe-a11y` for `cfg(target_os="macos")`; implement `readiness()` via `UiRecorder::check_permissions()` → `Ready` only if `accessibility && input_monitoring`, else `Blocked("accessibility")`/`Blocked("input_monitoring")` (drives the §5.9 rehearsal). Add Info.plist usage strings (Accessibility/Input Monitoring) + keep Screen Recording OUT for Lite. Commit.

### Task 3.2: Wire `MacAxCapture::start/poll/stop`

- [ ] `start()`: permission-gate first (P-CB2); register AXObservers (focus, value-changed, title-changed) + NSWorkspace app-activation; start a CGEventTap that counts keystrokes/clicks ONLY (never content). On idle >90s suspend.
- [ ] Build `AxSnapshot`s for the focused window. Since the mac fork exposes a single focused `ElementContext` (not a full tree), either (a) walk the AX tree from the focused app via `cidre` `ax::UiElement` children recursion and map with a small `element_context_to_node` helper in `map.rs`, or (b) ship a focused-element-granularity snapshot for v1 and deepen later — **decide in the task based on what the fork exposes; prefer a shallow tree walk for parity with Windows.** Map `role == "AXSecureTextField"` → `secure = Some(true)` (C4).
- [ ] `poll()` drains `CaptureItem::Snapshot` + `CaptureItem::Input`. `stop()` removes observers + invalidates the tap; safe twice.
- [ ] **Handoff to user for Mac testing** (Task 3.4). Commit: `feat(capture): wire MacAxCapture to vendored fork (CB3, C4, input counts)`.

### Task 3.3: Mac budgets + C6 teardown timing

- [ ] Idle-suspend + budget guard + gate-flip→observers-stop timing (mirror Task 2.5 for mac). Commit.

### Task 3.4: macOS on-hardware test checklist (handoff doc)

- [ ] Create `docs/superpowers/gates/2026-06-18-capture-bringup-macos-hardware.md` with the exact steps for the user to run on their Mac: grant/deny Accessibility + Input Monitoring → correct `capture_blocked`; an `AXSecureTextField` never yields a value (C4); pause flip latency (C6, #22); a short real session segments into a packet (against existing segmentation tests); idle>90s suspends; CPU/RSS within budget; daemon survives app close + reboot (CB1); menu-bar indicator parity (T&C §8.1). Commit.

**Phase 3 done when:** the code compiles for macOS in CI and the user confirms the hardware checklist passes on their Mac.

---

## Phase 4 — Lite/Detailed Depth + Consent UX (CB15/CB17)

**Independent of capture wiring** (can land in parallel). Lite ships and is the default; Detailed is selectable and recorded but its frame/OCR capture path is phase 2 (the picker just records the choice + asks the extra permission scope when chosen).

### Task 4.1: Rust study model — `CaptureDepth`

**Files:** `crates/nibbin-study/src/lib.rs:13-19,61-137,180-184`

- [ ] **Step 1: Write failing test** — `new_study(id, FullStudy, None, CaptureDepth::Detailed)` yields a snapshot with `depth == Detailed`; default is `Lite`; serde round-trips `"lite"`/`"detailed"`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3:** Add `#[derive(...)] enum CaptureDepth { #[default] Lite, Detailed }` (serde snake_case); add `depth: CaptureDepth` to `StudySnapshot` (with `#[serde(default)]` so existing study.json files load as Lite); add `depth` param to `new_study` + the `CreateStudy` command; thread through `transition`.
- [ ] **Step 4: Run, expect PASS.** Commit: `feat(study): add CaptureDepth lite|detailed to the study model`.

### Task 4.2: Daemon + Tauri command thread depth

**Files:** `observerd/src/lib.rs:101-117,310-333`, `app/src/commands.rs:110-143`

- [ ] **Step 1: Failing test** — a `create_study` control line with `"depth":"detailed"` yields a persisted study with `depth == Detailed`; missing depth defaults to Lite.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3:** Add `depth: Option<String>` to the `CreateStudy` control variant; map `"detailed"→Detailed` else `Lite`. In `commands.rs::create_study` add a `depth: String` param, validate ∈ {lite, detailed}, include it in the control JSON.
- [ ] **Step 4: Run, expect PASS.** Commit: `feat(observerd): thread capture depth through create_study`.

### Task 4.3: TS study machine + bridge

**Files:** `apps/desktop/src/core/study-machine.ts:18,49,80,89-93`, `bridge.ts:55`

- [ ] Mirror the Rust enum: `export type StudyDepth = 'lite' | 'detailed';`, add `depth` to `StudySnapshot`, `StudyCommand.create_study`, and `newStudy(studyId, kind, label, depth='lite')`. Update `bridge.createStudy(id, kind, label, depth)`. Add/extend the TS state-machine test. Commit: `feat(desktop): StudyDepth in the TS study machine + bridge`.

### Task 4.4: Depth picker in the consent flow (use-case framed, Lite default)

**Files:** `apps/desktop/src/ui/views/field-study.ts:230-296` (entryView/begin), `consent.ts:11-74`

- [ ] Add a depth-choice step (extend `entryView` or prepend to `consentView`) with two clearly-labeled options, Lite pre-selected:
  - **Lite — best for admin & comms work** *(recommended)*: "Reads the structure of your work — no screenshots." (examples: email, scheduling, invoicing, CRM, spreadsheets, docs, support)
  - **Detailed — best for creative & visual work**: "Adds periodic screenshots, processed and deleted on your device, so Nibbin can see inside tools like Photoshop or Premiere." (states the Screen Recording permission up front)
  - "Mixed? Start Lite." note.
- [ ] Make the consent claims depth-aware: Lite says "Accessibility tree + input counts, no screenshots"; Detailed adds the Screen-Recording + local-OCR + frames-never-leave-device line.
- [ ] `begin(kind, label, depth)` passes depth to `bridge.createStudy`. Commit: `feat(desktop): capture-depth picker in Field Study consent (CB17)`.

### Task 4.5: Surface chosen depth throughout

**Files:** `study.ts:16-65`, `notes.ts:14-50`, `field-study.ts:304-334` (quickScanView), `app/src/lib.rs:227-238` (tray)

- [ ] Show the depth wherever the study is shown: study view (e.g. "Lite mode — no screenshots"), Field Notes, quick-scan view, and the tray tooltip (e.g. "Nibbin — field study (Lite): 13d 4h left"). Read `study.depth` from `daemon.status`. Commit: `feat(desktop): show capture depth in study/notes/quick-scan/tray (CB17)`.

### Task 4.6: Supabase migration + packet ingest

**Files:** Create `supabase/migrations/20260618030000_diagnoses_depth.sql`; modify `apps/web/app/api/study/packet/route.ts:100`

- [ ] **Step 1:** Migration: `alter table public.diagnoses add column if not exists depth text not null default 'lite' check (depth in ('lite','detailed'));`
- [ ] **Step 2:** In the packet route, `depth: packet.depth ?? 'lite'` alongside `kind`.
- [ ] **Step 3:** Apply to BOTH dev and prod Supabase (per the two-instance rule). Commit: `feat(web): persist study capture depth on diagnoses (CB15)`.

**Phase 4 done when:** a user picks Lite/Detailed at consent (Lite default), the choice persists through study.json → packet → diagnoses, and is visible throughout the study.

---

## Deferred-with-reason (not in this plan)
- **Detailed-mode frame + OCR capture path (CB16):** the picker records the Detailed choice + asks Screen Recording, but the actual periodic-frame + local-OCR + OCR-text-redaction capture is phase 2, after Lite proves the bring-up on hardware.
- **Linux** (vendored AT-SPI stubs only); net-new event kinds.

## Cross-cutting verification (CB13/CB14)
- Keep `MockCapture` + `day14_headless` green throughout (seeded path must never regress — §9 cutover).
- A real captured session and a seeded fixture both produce valid packets through the **same** unchanged downstream path.
- Unhappy paths first-class: permission denied/revoked → `capture_blocked` + rehearsal; fork/observer crash → restart then `capture_blocked`; secure desktop → skip-with-gap; daemon dies → keep-alive restart; install broken → honest `daemon_health`; idle → explicit gap; budget exceeded → throttle/flag.

## Self-Review notes
- **Spec coverage:** CB1/CB2 → Phase 1; CB3 → Phase 3; CB4 → Phase 2; CB5/CB6/CB8 → Tasks 2.1/2.2/2.4/3.1/3.2; CB7/CB9 → 2.5/3.3; CB10 → 2.3; CB11 → Task 2.4 Cargo + provenance note; CB12 → 3.4 hardware checklist; CB13/CB14 → cross-cutting; CB15/CB16/CB17 → Phase 4. ✓
- **Open question carried:** Lite vs Screen-Recording entanglement (Task 2.3a spike) — must resolve before 2.4/3.2 finalize.
- **Type consistency:** `CaptureItem`/`InputCounts`/`CaptureReadiness` defined in 2.1, consumed in 2.2/2.4/3.2; `CaptureDepth` defined in 4.1, consumed in 4.2/4.3.
