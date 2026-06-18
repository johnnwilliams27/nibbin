use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

pub fn observerd_binary_name() -> &'static str {
    if cfg!(windows) { "observerd.exe" } else { "observerd" }
}

/// Resolve the bundled observerd binary. In a release bundle it sits in the
/// resource dir; in dev (`tauri dev`) it is the sibling debug build next to the
/// app binary.
pub fn observerd_path<R: Runtime>(app: &AppHandle<R>) -> anyhow::Result<PathBuf> {
    let name = observerd_binary_name();
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join(name);
        if p.exists() {
            return Ok(p);
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
    // Resolve uid without adding the libc crate.
    let uid_out = Command::new("id").arg("-u").output()?;
    anyhow::ensure!(uid_out.status.success(), "`id -u` failed");
    let uid = String::from_utf8(uid_out.stdout)?.trim().to_string();
    let domain = format!("gui/{uid}");
    let plist_str = plist.to_str().ok_or_else(|| anyhow::anyhow!("non-utf8 plist path"))?;
    // bootout is best-effort (no-op if not loaded); bootstrap (re)loads it.
    let _ = Command::new("launchctl").args(["bootout", &domain, plist_str]).status();
    let ok = Command::new("launchctl").args(["bootstrap", &domain, plist_str]).status()?;
    anyhow::ensure!(ok.success(), "launchctl bootstrap failed");
    Ok(())
}
