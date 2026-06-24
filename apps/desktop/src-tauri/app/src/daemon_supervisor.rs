use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Manager, Runtime};

/// PID of the `observerd` instance THIS app spawned (Windows). 0 = none spawned
/// by us (e.g. the daemon was already running, or we're on a platform where the
/// OS service manager owns it). Read on `RunEvent::Exit` to stop capture
/// deterministically when Nibbin quits. (0.2.5 lifecycle fix #3.)
static SPAWNED_OBSERVERD_PID: AtomicU32 = AtomicU32::new(0);

/// Returns true if the daemon wrote a heartbeat recently (within the last
/// 5 seconds). Used to guard against double-spawning on Windows.
fn daemon_is_running(store: &Path) -> bool {
    let heartbeat = store.join("daemon.status");
    if let Ok(meta) = std::fs::metadata(&heartbeat) {
        if let Ok(modified) = meta.modified() {
            if let Ok(age) = std::time::SystemTime::now().duration_since(modified) {
                return age.as_secs() < 5;
            }
        }
    }
    false
}

pub fn observerd_binary_name() -> &'static str {
    if cfg!(windows) {
        "observerd.exe"
    } else {
        "observerd"
    }
}

/// Resolve the bundled observerd binary. In a release bundle it sits in the
/// resource dir; in dev (`tauri dev`) it is the sibling debug build next to the
/// app binary.
pub fn observerd_path<R: Runtime>(app: &AppHandle<R>) -> anyhow::Result<PathBuf> {
    let name = observerd_binary_name();
    if let Ok(dir) = app.path().resource_dir() {
        // `bundle.resources: ["binaries/observerd*"]` ships the daemon under
        // <resourceDir>/binaries/ (the glob preserves the path); also accept the
        // resource root for forward-compat with a flattened (map-form) bundle.
        for cand in [dir.join("binaries").join(name), dir.join(name)] {
            if cand.exists() {
                return Ok(cand);
            }
        }
    }
    // dev fallback: target/<profile>/observerd next to the app binary
    let exe = std::env::current_exe()?;
    let sibling = exe.with_file_name(name);
    anyhow::ensure!(
        sibling.exists(),
        "observerd binary not found (checked resource dir and {})",
        sibling.display()
    );
    Ok(sibling)
}

pub const LAUNCH_LABEL: &str = "app.nibbin.observerd";

pub fn launchagent_plist(observerd: &Path, store: &Path) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
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
        store = store.display()
    )
}

pub const RUN_VALUE_NAME: &str = "NibbinObserver";

/// The HKCU\...\Run value data: the quoted observerd path + --store arg.
pub fn run_command_line(observerd: &Path, store: &Path) -> String {
    format!(
        "\"{}\" --store \"{}\"",
        observerd.display(),
        store.display()
    )
}

#[cfg(windows)]
pub fn register_windows(observerd: &Path, store: &Path) -> anyhow::Result<()> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    // Register for autostart at next login.
    let data = run_command_line(observerd, store);
    let status = Command::new("reg")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            RUN_VALUE_NAME,
            "/t",
            "REG_SZ",
            "/d",
            &data,
            "/f",
        ])
        .status()?;
    anyhow::ensure!(status.success(), "reg add (HKCU Run) failed");

    // D8: also spawn immediately on first launch (or after a reinstall) so
    // capture is available without a re-login. Guard: skip if a fresh heartbeat
    // exists (daemon already running) to avoid double-spawning.
    if !daemon_is_running(store) {
        let store_str = store
            .to_str()
            .ok_or_else(|| anyhow::anyhow!("non-utf8 store path"))?
            .to_string();
        // CREATE_NO_WINDOW (0x08000000) prevents a console window flashing on
        // Windows. The spawned process is detached — we don't wait for it.
        match Command::new(observerd)
            .args(["--store", &store_str])
            .creation_flags(0x0800_0000)
            .spawn()
        {
            // Record the PID so RunEvent::Exit can stop capture deterministically
            // when Nibbin quits (0.2.5 lifecycle fix #3), rather than leaving the
            // daemon running until its own watchdog notices.
            Ok(child) => SPAWNED_OBSERVERD_PID.store(child.id(), Ordering::SeqCst),
            // best-effort: a spawn failure here is non-fatal; the daemon-health
            // note will surface it on the next status poll.
            Err(e) => eprintln!("observerd spawn failed: {e}"),
        }
    }

    Ok(())
}

#[cfg(target_os = "macos")]
pub fn register_macos(observerd: &Path, store: &Path) -> anyhow::Result<()> {
    use std::process::Command;
    let home = std::env::var("HOME")?;
    let dir = Path::new(&home).join("Library/LaunchAgents");
    std::fs::create_dir_all(&dir)?;
    let plist = dir.join(format!("{LAUNCH_LABEL}.plist"));
    std::fs::write(&plist, launchagent_plist(observerd, store))?;
    // Resolve uid without adding the libc crate.
    let uid_out = Command::new("id").arg("-u").output()?;
    anyhow::ensure!(uid_out.status.success(), "`id -u` failed");
    let uid = String::from_utf8(uid_out.stdout)?.trim().to_string();
    let domain = format!("gui/{uid}");
    let plist_str = plist
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("non-utf8 plist path"))?;
    // bootout is best-effort (no-op if not loaded); bootstrap (re)loads it.
    let _ = Command::new("launchctl")
        .args(["bootout", &domain, plist_str])
        .status();
    let ok = Command::new("launchctl")
        .args(["bootstrap", &domain, plist_str])
        .status()?;
    anyhow::ensure!(ok.success(), "launchctl bootstrap failed");
    Ok(())
}

/// Register observerd with the OS scheduler and start it. Never panics: a
/// registration failure is surfaced via a `daemon.health` note next to the store
/// (read by read_status) and stderr — the app still runs (P-CB1/P-CB5).
///
/// Posture (gate RT-2 — dormant-daemon, accepted 2026-06-18): autostart is
/// registered on first app launch so the daemon is available to run a study.
/// It is DORMANT until the user consents to a study — `capture_allowed` is false
/// outside an active study, so NOTHING is captured pre-consent — and it is
/// removable. We accept this benign persistence over a spawn-on-demand flow,
/// because the daemon must already be running to receive the Start command.
pub fn ensure_daemon_running<R: Runtime>(app: &AppHandle<R>) {
    let result = (|| -> anyhow::Result<()> {
        let obs = observerd_path(app)?;
        let store = crate::commands::store_root(app)?;
        #[cfg(target_os = "macos")]
        {
            register_macos(&obs, &store)?;
        }
        #[cfg(windows)]
        {
            register_windows(&obs, &store)?;
        }
        // On platforms with no registration path (e.g. Linux/CI) this is a no-op.
        #[cfg(not(any(target_os = "macos", windows)))]
        {
            let _ = (&obs, &store);
        }
        Ok(())
    })();
    match result {
        Err(e) => {
            if let Ok(store) = crate::commands::store_root(app) {
                let _ = std::fs::write(store.join("daemon.health"), format!("install_failed: {e}"));
            }
            eprintln!("daemon registration failed: {e}");
        }
        Ok(()) => {
            if let Ok(store) = crate::commands::store_root(app) {
                let _ = std::fs::remove_file(store.join("daemon.health")); // clear stale failure
            }
        }
    }
}

/// Refresh the parent-liveness heartbeat the daemon watchdog reads. Called
/// ~1×/sec from the app's status-refresher thread; a stale (or absent) file
/// tells the daemon its supervising app is gone. Best-effort — a write failure
/// just means the watchdog falls back to its other (study-state) triggers.
/// (0.2.5 lifecycle fix #5, app side.)
pub fn touch_app_heartbeat<R: Runtime>(app: &AppHandle<R>) {
    if let Ok(store) = crate::commands::store_root(app) {
        let _ = std::fs::write(store.join("app.heartbeat"), chrono::Utc::now().to_rfc3339());
    }
}

/// Stop the `observerd` instance this app spawned (Windows), called on
/// `RunEvent::Exit` so quitting Nibbin deterministically stops capture instead
/// of relying solely on the daemon's own watchdog (0.2.5 lifecycle fix #3).
///
/// Uses `taskkill /PID` to kill the EXACT instance we launched (not a broad
/// `/IM` match), so we never tear down a newer daemon a concurrent install may
/// have started. No-op if we didn't spawn one (PID 0) or off Windows.
pub fn stop_spawned_daemon() {
    let pid = SPAWNED_OBSERVERD_PID.load(Ordering::SeqCst);
    if pid == 0 {
        return;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        // /T also kills children (e.g. the NER sidecar). CREATE_NO_WINDOW avoids
        // a console flash. Best-effort: ignore the result (process may already
        // be gone, e.g. via its own watchdog).
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(0x0800_0000)
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = pid; // macOS/Linux: the OS service manager owns the lifecycle.
    }
}
