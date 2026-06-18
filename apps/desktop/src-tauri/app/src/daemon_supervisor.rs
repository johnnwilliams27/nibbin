use std::path::PathBuf;
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
