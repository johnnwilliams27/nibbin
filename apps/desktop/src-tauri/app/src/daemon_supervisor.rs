use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

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
    use std::process::Command;
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
