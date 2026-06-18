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

pub const TASK_NAME: &str = "NibbinObserver";

pub fn scheduled_task_xml(observerd: &Path, store: &Path) -> String {
    format!(r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
  </Settings>
  <Actions>
    <Exec>
      <Command>{obs}</Command>
      <Arguments>--store "{store}"</Arguments>
    </Exec>
  </Actions>
</Task>"#, obs = observerd.display(), store = store.display())
}

#[cfg(windows)]
pub fn register_windows(observerd: &Path, store: &Path) -> anyhow::Result<()> {
    use std::process::Command;
    let xml = scheduled_task_xml(observerd, store);
    let tmp = std::env::temp_dir().join("nibbin-observer-task.xml");
    // Task Scheduler requires UTF-16 (with BOM) for /XML files.
    let utf16: Vec<u8> = xml.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let mut bytes = vec![0xFF, 0xFE]; // UTF-16 LE BOM
    bytes.extend(utf16);
    std::fs::write(&tmp, bytes)?;
    let tmp_str = tmp.to_str().ok_or_else(|| anyhow::anyhow!("non-utf8 temp path"))?;
    // /F makes re-registration idempotent.
    let create = Command::new("schtasks")
        .args(["/Create", "/TN", TASK_NAME, "/XML", tmp_str, "/F"])
        .status()?;
    anyhow::ensure!(create.success(), "schtasks /Create failed");
    // Start now so the user need not log out/in.
    let _ = Command::new("schtasks").args(["/Run", "/TN", TASK_NAME]).status();
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
    let plist_str = plist.to_str().ok_or_else(|| anyhow::anyhow!("non-utf8 plist path"))?;
    // bootout is best-effort (no-op if not loaded); bootstrap (re)loads it.
    let _ = Command::new("launchctl").args(["bootout", &domain, plist_str]).status();
    let ok = Command::new("launchctl").args(["bootstrap", &domain, plist_str]).status()?;
    anyhow::ensure!(ok.success(), "launchctl bootstrap failed");
    Ok(())
}
