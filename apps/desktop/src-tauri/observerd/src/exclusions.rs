//! Durable storage for user capture exclusions (T&C spec §5.1, T1/T2).
//! The file is the source of truth; the in-memory pipeline is a cache loaded
//! on `Daemon::open()`. A corrupt file fails CLOSED: `load_exclusions` returns
//! Err and the daemon (per §5.1) starts with capture SUSPENDED + the error
//! surfaced, rather than starting with no exclusions (TC-P3).

use anyhow::Context;
use nibbin_redaction::UserExclusions;
use std::path::Path;

const FILE: &str = "exclusions.json";

/// Persist exclusions atomically: write a temp file then rename, so a crash
/// mid-write can never leave a half-written file as the source of truth.
pub fn save_exclusions(root: &Path, ex: &UserExclusions) -> anyhow::Result<()> {
    let tmp = root.join("exclusions.json.tmp");
    std::fs::write(&tmp, serde_json::to_string(ex)?)?;
    std::fs::rename(&tmp, root.join(FILE))?;
    Ok(())
}

/// Load exclusions. Missing file → empty (default, first run). Unreadable or
/// unparseable file → Err (fail-closed; the caller must not start capture).
pub fn load_exclusions(root: &Path) -> anyhow::Result<UserExclusions> {
    let path = root.join(FILE);
    match std::fs::read_to_string(&path) {
        Ok(text) => {
            serde_json::from_str(&text).with_context(|| format!("{} is corrupt", path.display()))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(UserExclusions::default()),
        Err(e) => Err(e).with_context(|| format!("reading {}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let ex = UserExclusions {
            hosts: vec!["evil.com".into()],
            ..Default::default()
        };
        save_exclusions(dir.path(), &ex).unwrap();
        let back = load_exclusions(dir.path()).unwrap();
        assert_eq!(back.hosts, vec!["evil.com".to_string()]);
    }

    #[test]
    fn missing_file_loads_empty() {
        let dir = tempfile::tempdir().unwrap();
        let back = load_exclusions(dir.path()).unwrap();
        assert!(back.hosts.is_empty() && back.bundle_ids.is_empty() && back.app_names.is_empty());
    }

    #[test]
    fn corrupt_file_fails_closed() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("exclusions.json"), b"{not json").unwrap();
        assert!(
            load_exclusions(dir.path()).is_err(),
            "corrupt file must fail closed"
        );
    }
}
